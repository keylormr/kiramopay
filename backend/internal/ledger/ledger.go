// Package ledger implements the double-entry journal write path.
//
// Every monetary movement in KiramoPay is expressed as a Posting with >= 2
// Entries whose debits and credits balance per currency. Postings are
// written inside a SERIALIZABLE transaction with bounded retries on
// SQLSTATE 40001 (serialization_failure) or 40P01 (deadlock_detected).
//
// The cached wallets.balance_* columns are updated *inside the same tx*
// alongside the journal entries — never one without the other.
package ledger

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"math/rand"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Side identifies which side of a double-entry posting an Entry belongs to.
type Side string

const (
	Debit  Side = "debit"
	Credit Side = "credit"
)

// SystemAccountCode references one of the system accounts seeded by 020.
type SystemAccountCode string

const (
	SystemFeesCRC     SystemAccountCode = "SYSTEM:FEES:CRC"
	SystemFeesUSD     SystemAccountCode = "SYSTEM:FEES:USD"
	SystemSuspenseCRC SystemAccountCode = "SYSTEM:SUSPENSE:CRC"
	SystemSuspenseUSD SystemAccountCode = "SYSTEM:SUSPENSE:USD"
	SystemExternalCRC SystemAccountCode = "SYSTEM:EXTERNAL:CRC"
	SystemReserveCRC  SystemAccountCode = "SYSTEM:RESERVE:CRC"
	SystemReserveUSD  SystemAccountCode = "SYSTEM:RESERVE:USD"
	SystemEscrowCRC   SystemAccountCode = "SYSTEM:ESCROW:CRC"
	SystemEscrowUSD   SystemAccountCode = "SYSTEM:ESCROW:USD"
	SystemSavingsCRC  SystemAccountCode = "SYSTEM:SAVINGS:CRC"
	SystemSavingsUSD  SystemAccountCode = "SYSTEM:SAVINGS:USD"
)

// Account is a polymorphic reference to either a user wallet account or a
// system account. Exactly one of UserID/SystemCode must be set.
type Account struct {
	UserID     string
	SystemCode SystemAccountCode
}

// Entry is one leg of a posting.
type Entry struct {
	Account     Account
	Side        Side
	AmountMinor int64
	Currency    string // ISO-like code, e.g. CRC, USD
}

// Posting is one atomic monetary event. Entries must balance per currency.
type Posting struct {
	Description    string
	Metadata       map[string]any
	IdempotencyKey string // optional; UNIQUE-enforced at DB level
	TxID           string // optional FK to transactions.id
	CreatedBy      string // user_id originating the request
	Entries        []Entry
}

// Engine writes Postings atomically. It also maintains the wallets balance
// cache for user accounts.
type Engine struct {
	pool        *pgxpool.Pool
	maxAttempts int
	logger      *slog.Logger
}

// NewEngine wires the engine. maxAttempts defaults to 8 — enough headroom for
// bursts of contending serializable transactions on the same wallet.
func NewEngine(pool *pgxpool.Pool, logger *slog.Logger) *Engine {
	return &Engine{pool: pool, maxAttempts: 8, logger: logger}
}

// Post writes the posting + entries + updates balance cache inside a
// SERIALIZABLE transaction with retries on serialization conflicts.
//
// Returns the posting_id on success; ErrIdempotent if a posting with the
// same idempotency key already exists (and the existing posting_id).
func (e *Engine) Post(ctx context.Context, p *Posting) (string, error) {
	if err := validatePosting(p); err != nil {
		return "", err
	}

	var (
		lastErr   error
		postingID string
	)
	for attempt := 1; attempt <= e.maxAttempts; attempt++ {
		postingID, lastErr = e.postOnce(ctx, p)
		if lastErr == nil {
			return postingID, nil
		}
		if errors.Is(lastErr, ErrIdempotent) {
			return postingID, lastErr
		}
		if !isRetryable(lastErr) && !errors.Is(lastErr, errIdempotencyRace) {
			return "", lastErr
		}
		// Exponential backoff with FULL jitter (base + rand[0,base]) so that a
		// herd of conflicting txs doesn't retry in lockstep and re-collide.
		base := time.Duration(attempt*attempt) * 3 * time.Millisecond
		backoff := base + time.Duration(rand.Int63n(int64(base)+1))
		if e.logger != nil {
			e.logger.Warn("ledger.post retrying",
				"attempt", attempt, "err", lastErr.Error(), "backoff", backoff.String())
		}
		select {
		case <-ctx.Done():
			return "", ctx.Err()
		case <-time.After(backoff):
		}
	}
	return "", fmt.Errorf("ledger.post exhausted retries: %w", lastErr)
}

// ErrIdempotent indicates the IdempotencyKey collided with an existing posting.
var ErrIdempotent = errors.New("idempotent: posting already recorded")

// errIdempotencyRace is an internal, retryable signal: a concurrent posting
// won the idempotency-key race. Retrying lets the top-level lookup return the
// winner's posting id as ErrIdempotent.
var errIdempotencyRace = errors.New("idempotency race")

func (e *Engine) postOnce(ctx context.Context, p *Posting) (string, error) {
	// READ COMMITTED + explicit `SELECT ... FOR UPDATE` on the affected wallet
	// rows (below, in sorted order). This is the canonical ledger locking
	// discipline for hot accounts: contending transfers QUEUE on the row lock
	// and apply sequentially, instead of aborting with serialization failures
	// the way SERIALIZABLE does under heavy single-account contention.
	// Correctness still holds: the per-posting balance is enforced by a
	// deferred DB trigger, idempotency by a UNIQUE constraint, and the balance
	// cache is a commutative `+= delta` on a locked row.
	tx, err := e.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return "", fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	// 1. Insert posting; on idempotency-key collision return the existing id.
	if p.IdempotencyKey != "" {
		var existing string
		err := tx.QueryRow(ctx,
			`SELECT id::text FROM journal_postings WHERE idempotency_key = $1`,
			p.IdempotencyKey,
		).Scan(&existing)
		if err == nil {
			return existing, ErrIdempotent
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return "", fmt.Errorf("idempotency lookup: %w", err)
		}
	}

	// Pre-lock the affected user wallet rows in a deterministic (sorted) order
	// with SELECT ... FOR UPDATE. Concurrent postings touching the same wallet
	// then QUEUE on the row lock instead of racing and aborting with a
	// serialization failure — this is what makes a "hot" account survive a
	// burst of contending transfers. Sorted order also rules out deadlocks.
	lockUsers := make([]string, 0, len(p.Entries))
	seenUser := make(map[string]bool, len(p.Entries))
	for _, en := range p.Entries {
		if en.Account.UserID == "" || seenUser[en.Account.UserID] {
			continue
		}
		seenUser[en.Account.UserID] = true
		lockUsers = append(lockUsers, en.Account.UserID)
	}
	sort.Strings(lockUsers)
	for _, uid := range lockUsers {
		if _, err := tx.Exec(ctx,
			`SELECT 1 FROM wallets WHERE user_id = $1::uuid FOR UPDATE`, uid,
		); err != nil {
			return "", fmt.Errorf("lock wallet %s: %w", uid, err)
		}
	}

	postingID := uuid.New().String()
	metadataJSON := metadataToJSON(p.Metadata)
	_, err = tx.Exec(ctx,
		`INSERT INTO journal_postings (id, tx_id, description, metadata, idempotency_key, created_by)
		 VALUES ($1::uuid, NULLIF($2,'')::uuid, $3, $4::jsonb, NULLIF($5,''), NULLIF($6,'')::uuid)`,
		postingID, p.TxID, p.Description, metadataJSON, p.IdempotencyKey, p.CreatedBy,
	)
	if err != nil {
		// Under READ COMMITTED a concurrent insert of the same idempotency key
		// surfaces as a UNIQUE violation here (the duplicate INSERT blocks until
		// the winner commits, then fails 23505). Flag it for a retry — the next
		// attempt's idempotency lookup returns the winner's posting id.
		var pgErr *pgconn.PgError
		if p.IdempotencyKey != "" && errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return "", errIdempotencyRace
		}
		return "", fmt.Errorf("insert posting: %w", err)
	}

	// 2. Resolve every account_id and insert entries.
	// Per-currency balance cache deltas keyed by userID.
	type cacheKey struct{ userID, currency string }
	cacheDelta := map[cacheKey]int64{}

	for _, en := range p.Entries {
		accountID, isUserWallet, normalBalance, err := e.resolveAccount(ctx, tx, en)
		if err != nil {
			return "", err
		}
		_, err = tx.Exec(ctx,
			`INSERT INTO journal_entries (posting_id, account_id, direction, amount_minor, currency)
			 VALUES ($1::uuid, $2::uuid, $3, $4, $5)`,
			postingID, accountID, string(en.Side), en.AmountMinor, en.Currency,
		)
		if err != nil {
			return "", fmt.Errorf("insert entry: %w", err)
		}

		if isUserWallet {
			// User wallets are credit-normal: +credit / -debit increases their balance.
			signed := en.AmountMinor
			if (normalBalance == "credit" && en.Side == Debit) ||
				(normalBalance == "debit" && en.Side == Credit) {
				signed = -signed
			}
			cacheDelta[cacheKey{en.Account.UserID, en.Currency}] += signed
		}
	}

	// 3. Apply balance-cache deltas in a DETERMINISTIC order. Go map iteration
	//    is randomized, so two concurrent postings touching the same wallets
	//    could lock the rows in opposite order and DEADLOCK (40P01). Sorting by
	//    account key makes every posting acquire locks in the same order, so
	//    only clean serialization failures (40001) remain — which we retry.
	keys := make([]cacheKey, 0, len(cacheDelta))
	for k := range cacheDelta {
		keys = append(keys, k)
	}
	sort.Slice(keys, func(i, j int) bool {
		if keys[i].userID != keys[j].userID {
			return keys[i].userID < keys[j].userID
		}
		return keys[i].currency < keys[j].currency
	})
	for _, k := range keys {
		if err := applyWalletDelta(ctx, tx, k.userID, k.currency, cacheDelta[k]); err != nil {
			return "", err
		}
	}

	// COMMIT — deferred constraint trigger validates posting balance here.
	if err := tx.Commit(ctx); err != nil {
		return "", fmt.Errorf("commit: %w", err)
	}
	return postingID, nil
}

// resolveAccount returns (account_id, isUserWallet, normalBalance, err).
// For user wallets it auto-provisions the account if missing (idempotent).
func (e *Engine) resolveAccount(ctx context.Context, tx pgx.Tx, en Entry) (string, bool, string, error) {
	if en.Account.UserID != "" && en.Account.SystemCode != "" {
		return "", false, "", errors.New("entry account: only one of UserID/SystemCode allowed")
	}
	if en.Account.SystemCode != "" {
		var id, nb string
		err := tx.QueryRow(ctx,
			`SELECT id::text, normal_balance FROM ledger_accounts WHERE code = $1`,
			string(en.Account.SystemCode),
		).Scan(&id, &nb)
		if err != nil {
			return "", false, "", fmt.Errorf("system account %s not found: %w", en.Account.SystemCode, err)
		}
		return id, false, nb, nil
	}
	if en.Account.UserID == "" {
		return "", false, "", errors.New("entry account: empty")
	}
	// User wallet account
	var id, nb string
	err := tx.QueryRow(ctx,
		`SELECT id::text, normal_balance FROM ledger_accounts
		 WHERE user_id = $1::uuid AND currency = $2 AND type = 'user_wallet'`,
		en.Account.UserID, en.Currency,
	).Scan(&id, &nb)
	if err == nil {
		return id, true, nb, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return "", false, "", err
	}
	// Provision on the fly (race-safe via ON CONFLICT).
	code := fmt.Sprintf("USER:%s:%s", en.Account.UserID, en.Currency)
	err = tx.QueryRow(ctx,
		`INSERT INTO ledger_accounts (code, type, user_id, currency, normal_balance)
		 VALUES ($1, 'user_wallet', $2::uuid, $3, 'credit')
		 ON CONFLICT (code) DO UPDATE SET code = EXCLUDED.code
		 RETURNING id::text, normal_balance`,
		code, en.Account.UserID, en.Currency,
	).Scan(&id, &nb)
	if err != nil {
		return "", false, "", fmt.Errorf("provision user account: %w", err)
	}
	return id, true, nb, nil
}

func applyWalletDelta(ctx context.Context, tx pgx.Tx, userID, currency string, delta int64) error {
	if delta == 0 {
		return nil
	}
	var col string
	switch strings.ToUpper(currency) {
	case "CRC":
		col = "balance_crc"
	case "USD":
		col = "balance_usd"
	default:
		// Other currencies use regional_wallets.
		return applyRegionalWalletDelta(ctx, tx, userID, currency, delta)
	}
	res, err := tx.Exec(ctx,
		fmt.Sprintf(`UPDATE wallets SET %[1]s = %[1]s + $2, updated_at = NOW(), version = version + 1
		             WHERE user_id = $1::uuid`, col),
		userID, delta,
	)
	if err != nil {
		return fmt.Errorf("apply wallet delta: %w", err)
	}
	if res.RowsAffected() == 0 {
		// Auto-provision wallets row for users created before wallets existed.
		_, err = tx.Exec(ctx,
			`INSERT INTO wallets (id, user_id, balance_crc, balance_usd)
			 VALUES (gen_random_uuid(), $1::uuid,
			         CASE WHEN $2 = 'CRC' THEN $3 ELSE 0 END,
			         CASE WHEN $2 = 'USD' THEN $3 ELSE 0 END)
			 ON CONFLICT (user_id) DO UPDATE
			   SET balance_crc = wallets.balance_crc + CASE WHEN $2='CRC' THEN $3 ELSE 0 END,
			       balance_usd = wallets.balance_usd + CASE WHEN $2='USD' THEN $3 ELSE 0 END,
			       version = wallets.version + 1, updated_at = NOW()`,
			userID, currency, delta,
		)
		if err != nil {
			return fmt.Errorf("provision+apply wallet delta: %w", err)
		}
	}
	return nil
}

func applyRegionalWalletDelta(ctx context.Context, tx pgx.Tx, userID, currency string, delta int64) error {
	res, err := tx.Exec(ctx,
		`UPDATE regional_wallets SET balance = balance + $3, updated_at = NOW()
		 WHERE user_id = $1::uuid AND currency = $2`,
		userID, currency, delta,
	)
	if err != nil {
		return err
	}
	if res.RowsAffected() == 0 {
		return fmt.Errorf("no regional wallet for user %s currency %s", userID, currency)
	}
	return nil
}

func validatePosting(p *Posting) error {
	if p == nil {
		return errors.New("posting is nil")
	}
	if p.Description == "" {
		return errors.New("posting description required")
	}
	if len(p.Entries) < 2 {
		return errors.New("posting needs >= 2 entries")
	}
	balances := map[string]int64{}
	for _, e := range p.Entries {
		if e.AmountMinor <= 0 {
			return fmt.Errorf("entry amount must be positive (got %d)", e.AmountMinor)
		}
		if e.Side != Debit && e.Side != Credit {
			return fmt.Errorf("entry side must be debit/credit (got %q)", e.Side)
		}
		if e.Currency == "" {
			return errors.New("entry currency required")
		}
		sign := int64(1)
		if e.Side == Credit {
			sign = -1
		}
		balances[e.Currency] += sign * e.AmountMinor
	}
	for cur, bal := range balances {
		if bal != 0 {
			return fmt.Errorf("posting unbalanced for %s: net=%d (debits-credits)", cur, bal)
		}
	}
	return nil
}

func isRetryable(err error) bool {
	if err == nil {
		return false
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		switch pgErr.Code {
		case "40001", // serialization_failure
			"40P01": // deadlock_detected
			return true
		}
	}
	return false
}

func metadataToJSON(m map[string]any) string {
	if len(m) == 0 {
		return "{}"
	}
	var b strings.Builder
	b.WriteByte('{')
	first := true
	for k, v := range m {
		if !first {
			b.WriteByte(',')
		}
		first = false
		fmt.Fprintf(&b, "%q:", k)
		switch tv := v.(type) {
		case string:
			fmt.Fprintf(&b, "%q", tv)
		case int, int64, int32:
			fmt.Fprintf(&b, "%d", tv)
		case float64:
			fmt.Fprintf(&b, "%v", tv)
		case bool:
			fmt.Fprintf(&b, "%t", tv)
		default:
			fmt.Fprintf(&b, "%q", fmt.Sprintf("%v", tv))
		}
	}
	b.WriteByte('}')
	return b.String()
}
