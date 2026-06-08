// Package reconcile runs scheduled reconciliation between the cached
// wallets.balance_* columns and the immutable journal. Any drift is
// reported as a high-severity audit event so on-call can investigate.
//
// When auto-fix is enabled (WithAutoFix) the worker also CORRECTS drift by
// snapping the wallets cache to the journal — the journal is the source of
// truth (see internal/ledger). The correction runs under the same
// `SELECT ... FROM wallets FOR UPDATE` lock the ledger Post path takes, so it
// serializes against concurrent postings and can never clobber an in-flight
// movement. Drift larger than the configured safety cap is alerted but NOT
// auto-corrected — a gap that big signals a deeper bug a human must inspect.
package reconcile

import (
	"context"
	"log/slog"
	"sync/atomic"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/kiramopay/backend/internal/audit"
)

type Service struct {
	db              *pgxpool.Pool
	auditLogger     *audit.Logger
	interval        time.Duration
	logger          *slog.Logger
	autoFix         bool
	maxAutoFixDrift int64 // abs(drift) above this (per currency) is alerted, not fixed; 0 = no cap
	lastDrift       atomic.Int64
	lastFixed       atomic.Int64
}

// Option configures optional reconcile behaviour.
type Option func(*Service)

// WithAutoFix enables automatic correction of detected drift by snapping the
// wallets cache to the journal. maxDriftMinor is a per-currency safety cap: any
// wallet whose absolute drift exceeds it is alerted but left untouched for
// manual review. Pass 0 to disable the cap (always fix).
func WithAutoFix(maxDriftMinor int64) Option {
	return func(s *Service) {
		s.autoFix = true
		if maxDriftMinor < 0 {
			maxDriftMinor = 0
		}
		s.maxAutoFixDrift = maxDriftMinor
	}
}

// NewService wires the reconciliation worker. Set interval to e.g. 1h locally
// or run as a Kubernetes CronJob in production.
func NewService(db *pgxpool.Pool, audit *audit.Logger, interval time.Duration, logger *slog.Logger, opts ...Option) *Service {
	if interval <= 0 {
		interval = 1 * time.Hour
	}
	s := &Service{db: db, auditLogger: audit, interval: interval, logger: logger}
	for _, o := range opts {
		o(s)
	}
	return s
}

// Run blocks until ctx is cancelled, executing a reconcile each interval.
func (s *Service) Run(ctx context.Context) {
	t := time.NewTicker(s.interval)
	defer t.Stop()
	// Run immediately at startup so drift surfaces fast.
	s.runOnce(ctx)
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			s.runOnce(ctx)
		}
	}
}

// Report is one snapshot of reconciliation results.
type Report struct {
	StartedAt     time.Time
	FinishedAt    time.Time
	WalletsTotal  int
	WalletsBad    int   // wallets observed with drift
	WalletsFixed  int   // wallets auto-corrected this run
	WalletsCapped int   // wallets whose drift exceeded the safety cap (left for humans)
	DriftCRC      int64 // sum of observed CRC drift
	DriftUSD      int64 // sum of observed USD drift
	FixedDriftCRC int64 // sum of CRC drift corrected
	FixedDriftUSD int64 // sum of USD drift corrected
}

// candidate is a wallet flagged as drifted by the (lock-free) survey query.
type candidate struct {
	userID                         string
	cacheCRC, journalCRC, driftCRC int64
	cacheUSD, journalUSD, driftUSD int64
}

// RunOnce is the externally-callable entry point used by HTTP /admin endpoints.
func (s *Service) RunOnce(ctx context.Context) (*Report, error) {
	return s.runOnceErr(ctx)
}

func (s *Service) runOnce(ctx context.Context) {
	if _, err := s.runOnceErr(ctx); err != nil {
		if s.logger != nil {
			s.logger.Error("reconcile failed", "error", err)
		}
	}
}

func (s *Service) runOnceErr(ctx context.Context) (*Report, error) {
	rpt := &Report{StartedAt: time.Now()}

	// Phase 1: lock-free survey of every wallet to find drift candidates.
	total, candidates, err := s.survey(ctx)
	if err != nil {
		return nil, err
	}
	rpt.WalletsTotal = total

	// Phase 2: act on each drifted wallet — alert, and optionally correct.
	for _, c := range candidates {
		rpt.WalletsBad++
		rpt.DriftCRC += c.driftCRC
		rpt.DriftUSD += c.driftUSD

		if !s.autoFix {
			s.alertDrift(c, false)
			continue
		}
		if s.exceedsCap(c) {
			rpt.WalletsCapped++
			s.alertDrift(c, true) // alert, but do not touch — needs human review
			continue
		}

		fixedCRC, fixedUSD, fixed, ferr := s.fixWallet(ctx, c.userID)
		if ferr != nil {
			if s.logger != nil {
				s.logger.Error("reconcile auto-fix failed", "user_id", c.userID, "error", ferr)
			}
			s.alertDrift(c, false)
			continue
		}
		if !fixed {
			// Drift resolved on its own between survey and lock — nothing to do.
			continue
		}
		rpt.WalletsFixed++
		rpt.FixedDriftCRC += fixedCRC
		rpt.FixedDriftUSD += fixedUSD
		s.auditFix(c.userID, fixedCRC, fixedUSD)
	}

	rpt.FinishedAt = time.Now()
	s.lastDrift.Store(rpt.DriftCRC)
	s.lastFixed.Store(rpt.FixedDriftCRC)
	if s.logger != nil {
		s.logger.Info("reconcile complete",
			"wallets_total", rpt.WalletsTotal,
			"wallets_bad", rpt.WalletsBad,
			"wallets_fixed", rpt.WalletsFixed,
			"wallets_capped", rpt.WalletsCapped,
			"drift_crc", rpt.DriftCRC,
			"drift_usd", rpt.DriftUSD,
			"fixed_drift_crc", rpt.FixedDriftCRC,
			"fixed_drift_usd", rpt.FixedDriftUSD,
			"auto_fix", s.autoFix,
			"duration_ms", rpt.FinishedAt.Sub(rpt.StartedAt).Milliseconds(),
		)
	}
	return rpt, nil
}

// survey reads the drift view without locks and returns total wallet count plus
// only the drifted rows. It buffers candidates so the cursor is closed before
// the per-wallet correction transactions open.
func (s *Service) survey(ctx context.Context) (int, []candidate, error) {
	rows, err := s.db.Query(ctx, `
		SELECT user_id::text,
		       cache_crc, journal_crc, drift_crc,
		       cache_usd, journal_usd, drift_usd
		FROM wallet_journal_drift`)
	if err != nil {
		return 0, nil, err
	}
	defer rows.Close()

	total := 0
	var candidates []candidate
	for rows.Next() {
		var c candidate
		if err := rows.Scan(&c.userID,
			&c.cacheCRC, &c.journalCRC, &c.driftCRC,
			&c.cacheUSD, &c.journalUSD, &c.driftUSD); err != nil {
			return 0, nil, err
		}
		total++
		if c.driftCRC != 0 || c.driftUSD != 0 {
			candidates = append(candidates, c)
		}
	}
	if err := rows.Err(); err != nil {
		return 0, nil, err
	}
	return total, candidates, nil
}

func (s *Service) exceedsCap(c candidate) bool {
	if s.maxAutoFixDrift <= 0 {
		return false
	}
	return abs(c.driftCRC) > s.maxAutoFixDrift || abs(c.driftUSD) > s.maxAutoFixDrift
}

// fixWallet re-derives the journal truth for one user UNDER the wallet row lock
// and snaps the cache to it. Because the ledger Post path locks the same row
// before writing, this serializes correctly: any in-flight posting either
// completes before we read (so we see consistent journal+cache) or blocks until
// we release. Returns the corrected drift and whether a write happened.
func (s *Service) fixWallet(ctx context.Context, userID string) (driftCRC, driftUSD int64, fixed bool, err error) {
	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return 0, 0, false, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	// Lock the wallet row; this is the same lock ledger.Post acquires.
	var cacheCRC, cacheUSD int64
	if err := tx.QueryRow(ctx,
		`SELECT balance_crc, balance_usd FROM wallets WHERE user_id = $1::uuid FOR UPDATE`,
		userID,
	).Scan(&cacheCRC, &cacheUSD); err != nil {
		return 0, 0, false, err
	}

	// Re-derive journal truth while holding the lock — stable now.
	var journalCRC, journalUSD int64
	if err := tx.QueryRow(ctx,
		`SELECT
		   COALESCE((SELECT balance_minor FROM ledger_account_balances
		             WHERE user_id = $1::uuid AND currency = 'CRC'), 0),
		   COALESCE((SELECT balance_minor FROM ledger_account_balances
		             WHERE user_id = $1::uuid AND currency = 'USD'), 0)`,
		userID,
	).Scan(&journalCRC, &journalUSD); err != nil {
		return 0, 0, false, err
	}

	driftCRC = cacheCRC - journalCRC
	driftUSD = cacheUSD - journalUSD
	if driftCRC == 0 && driftUSD == 0 {
		return 0, 0, false, tx.Commit(ctx) // resolved between survey and lock
	}

	if _, err := tx.Exec(ctx,
		`UPDATE wallets
		    SET balance_crc = $2, balance_usd = $3,
		        version = version + 1, updated_at = NOW()
		  WHERE user_id = $1::uuid`,
		userID, journalCRC, journalUSD,
	); err != nil {
		return 0, 0, false, err
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, 0, false, err
	}
	return driftCRC, driftUSD, true, nil
}

func (s *Service) alertDrift(c candidate, capped bool) {
	if s.auditLogger == nil {
		return
	}
	s.auditLogger.Log(audit.Event{
		UserID:       c.userID,
		Action:       "reconcile_drift",
		ResourceType: "wallet",
		ResourceID:   c.userID,
		Details: map[string]interface{}{
			"cache_crc":       c.cacheCRC,
			"journal_crc":     c.journalCRC,
			"drift_crc":       c.driftCRC,
			"cache_usd":       c.cacheUSD,
			"journal_usd":     c.journalUSD,
			"drift_usd":       c.driftUSD,
			"exceeds_cap":     capped,
		},
		RiskLevel: "high",
	})
}

func (s *Service) auditFix(userID string, correctedCRC, correctedUSD int64) {
	if s.auditLogger == nil {
		return
	}
	s.auditLogger.Log(audit.Event{
		UserID:       userID,
		Action:       "reconcile_autofix",
		ResourceType: "wallet",
		ResourceID:   userID,
		Details: map[string]interface{}{
			"corrected_drift_crc": correctedCRC,
			"corrected_drift_usd": correctedUSD,
			"resolution":          "cache snapped to journal",
		},
		RiskLevel: "high",
	})
}

func abs(n int64) int64 {
	if n < 0 {
		return -n
	}
	return n
}

// LastDriftCRC returns the most recently observed CRC drift across all wallets.
func (s *Service) LastDriftCRC() int64 { return s.lastDrift.Load() }

// LastFixedCRC returns the CRC drift corrected in the most recent run.
func (s *Service) LastFixedCRC() int64 { return s.lastFixed.Load() }
