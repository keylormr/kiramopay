// Package reconcile runs scheduled reconciliation between the cached
// wallets.balance_* columns and the immutable journal. Any drift is
// reported as a high-severity audit event so on-call can investigate.
package reconcile

import (
	"context"
	"log/slog"
	"sync/atomic"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/kiramopay/backend/internal/audit"
)

type Service struct {
	db          *pgxpool.Pool
	auditLogger *audit.Logger
	interval    time.Duration
	logger      *slog.Logger
	lastDrift   atomic.Int64
}

// NewService wires the reconciliation worker. Set interval to e.g. 1h locally
// or run as a Kubernetes CronJob in production.
func NewService(db *pgxpool.Pool, audit *audit.Logger, interval time.Duration, logger *slog.Logger) *Service {
	if interval <= 0 {
		interval = 1 * time.Hour
	}
	return &Service{db: db, auditLogger: audit, interval: interval, logger: logger}
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
	StartedAt    time.Time
	FinishedAt   time.Time
	WalletsTotal int
	WalletsBad   int
	DriftCRC     int64
	DriftUSD     int64
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
	rows, err := s.db.Query(ctx, `
		SELECT user_id::text,
		       cache_crc, journal_crc, drift_crc,
		       cache_usd, journal_usd, drift_usd
		FROM wallet_journal_drift`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var (
			uid        string
			cacheCRC   int64
			journalCRC int64
			driftCRC   int64
			cacheUSD   int64
			journalUSD int64
			driftUSD   int64
		)
		if err := rows.Scan(&uid, &cacheCRC, &journalCRC, &driftCRC, &cacheUSD, &journalUSD, &driftUSD); err != nil {
			return nil, err
		}
		rpt.WalletsTotal++
		if driftCRC != 0 || driftUSD != 0 {
			rpt.WalletsBad++
			rpt.DriftCRC += driftCRC
			rpt.DriftUSD += driftUSD
			if s.auditLogger != nil {
				s.auditLogger.Log(audit.Event{
					UserID:       uid,
					Action:       "reconcile_drift",
					ResourceType: "wallet",
					ResourceID:   uid,
					Details: map[string]interface{}{
						"cache_crc":   cacheCRC,
						"journal_crc": journalCRC,
						"drift_crc":   driftCRC,
						"cache_usd":   cacheUSD,
						"journal_usd": journalUSD,
						"drift_usd":   driftUSD,
					},
					RiskLevel: "high",
				})
			}
		}
	}
	rpt.FinishedAt = time.Now()
	s.lastDrift.Store(rpt.DriftCRC)
	if s.logger != nil {
		s.logger.Info("reconcile complete",
			"wallets_total", rpt.WalletsTotal,
			"wallets_bad", rpt.WalletsBad,
			"drift_crc", rpt.DriftCRC,
			"drift_usd", rpt.DriftUSD,
			"duration_ms", rpt.FinishedAt.Sub(rpt.StartedAt).Milliseconds(),
		)
	}
	return rpt, nil
}

// LastDriftCRC returns the most recently observed CRC drift across all wallets.
func (s *Service) LastDriftCRC() int64 { return s.lastDrift.Load() }
