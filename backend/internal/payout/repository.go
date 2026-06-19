package payout

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Repository persists payouts.
type Repository struct {
	db *pgxpool.Pool
}

func NewRepository(db *pgxpool.Pool) *Repository {
	return &Repository{db: db}
}

const payoutCols = `
	id::text, user_id::text, rail, amount_minor, currency, status,
	destination, COALESCE(external_id, ''), COALESCE(failure_reason, ''),
	idempotency_key, processing_at, completed_at, failed_at,
	created_at, updated_at`

func scanPayout(row pgx.Row) (*Payout, error) {
	var (
		p       Payout
		destRaw []byte
	)
	err := row.Scan(
		&p.ID, &p.UserID, &p.Rail, &p.AmountMinor, &p.Currency, &p.Status,
		&destRaw, &p.ExternalID, &p.FailureReason,
		&p.IdempotencyKey, &p.ProcessingAt, &p.CompletedAt, &p.FailedAt,
		&p.CreatedAt, &p.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if len(destRaw) > 0 {
		if err := json.Unmarshal(destRaw, &p.Destination); err != nil {
			return nil, fmt.Errorf("decode destination: %w", err)
		}
	}
	return &p, nil
}

// CreateOrGet inserts a new pending payout, or — if one already exists for the
// same (user_id, idempotency_key) — returns the existing row untouched. The
// second return value reports whether a new row was created. This is the
// request-level idempotency guard: a retried POST never opens a duplicate.
func (r *Repository) CreateOrGet(ctx context.Context, userID string, req *CreateRequest) (*Payout, bool, error) {
	destJSON, err := json.Marshal(req.Destination)
	if err != nil {
		return nil, false, fmt.Errorf("encode destination: %w", err)
	}
	row := r.db.QueryRow(ctx, `
		INSERT INTO payouts (user_id, rail, amount_minor, currency, destination, idempotency_key)
		VALUES ($1::uuid, $2, $3, $4, $5::jsonb, $6)
		ON CONFLICT (user_id, idempotency_key) DO NOTHING
		RETURNING `+payoutCols,
		userID, req.Rail, req.AmountMinor, req.Currency, destJSON, req.IdempotencyKey,
	)
	p, err := scanPayout(row)
	if err == nil {
		return p, true, nil
	}
	if !errors.Is(err, ErrNotFound) {
		return nil, false, err
	}
	// Conflict: a payout with this idempotency key already exists — return it.
	existing, gerr := r.GetByIdempotencyKey(ctx, userID, req.IdempotencyKey)
	if gerr != nil {
		return nil, false, gerr
	}
	return existing, false, nil
}

func (r *Repository) Get(ctx context.Context, id string) (*Payout, error) {
	row := r.db.QueryRow(ctx, `SELECT `+payoutCols+` FROM payouts WHERE id = $1::uuid`, id)
	return scanPayout(row)
}

func (r *Repository) GetByIdempotencyKey(ctx context.Context, userID, key string) (*Payout, error) {
	row := r.db.QueryRow(ctx,
		`SELECT `+payoutCols+` FROM payouts WHERE user_id = $1::uuid AND idempotency_key = $2`,
		userID, key)
	return scanPayout(row)
}

// ListByUser returns the user's payouts, newest first.
func (r *Repository) ListByUser(ctx context.Context, userID string, limit int) ([]Payout, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	rows, err := r.db.Query(ctx,
		`SELECT `+payoutCols+` FROM payouts WHERE user_id = $1::uuid
		 ORDER BY created_at DESC LIMIT $2`, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]Payout, 0, limit)
	for rows.Next() {
		p, err := scanPayout(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *p)
	}
	return out, rows.Err()
}

// ListStuckProcessing returns processing payouts whose processing_at is older
// than olderThanSecs, oldest first, for the settlement poller to reconcile
// against the rail. The grace period keeps the poller from racing with an
// in-flight synchronous submit; idempotent Send + ledger keys make a race
// harmless regardless. Payouts with an empty external id are included — the
// poller re-dispatches them (Send is idempotent), so a crash between debit and
// Send self-heals instead of stranding money.
func (r *Repository) ListStuckProcessing(ctx context.Context, olderThanSecs, limit int) ([]Payout, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	if olderThanSecs < 0 {
		olderThanSecs = 0
	}
	rows, err := r.db.Query(ctx,
		`SELECT `+payoutCols+` FROM payouts
		 WHERE status = 'processing'
		   AND COALESCE(processing_at, created_at) < NOW() - make_interval(secs => $1)
		 ORDER BY processing_at ASC NULLS FIRST LIMIT $2`, olderThanSecs, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]Payout, 0, limit)
	for rows.Next() {
		p, err := scanPayout(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *p)
	}
	return out, rows.Err()
}

// transition atomically moves a payout from → to, applying the matching column
// updates. It returns ErrBadTransition if the row was not in `from` (someone
// else moved it first) — this guarded UPDATE is the concurrency mutex that
// guarantees a money-moving action runs at most once.
func (r *Repository) transition(ctx context.Context, id string, from, to Status, set string, args ...any) (*Payout, error) {
	// $1=id, $2=from, $3=to are fixed; extra args start at $4.
	q := `UPDATE payouts SET status = $3, updated_at = NOW()` + set +
		` WHERE id = $1::uuid AND status = $2 RETURNING ` + payoutCols
	full := append([]any{id, from, to}, args...)
	row := r.db.QueryRow(ctx, q, full...)
	p, err := scanPayout(row)
	if errors.Is(err, ErrNotFound) {
		// Disambiguate: row exists but not in `from`, vs row absent.
		if _, gerr := r.Get(ctx, id); gerr == nil {
			return nil, ErrBadTransition
		}
		return nil, ErrNotFound
	}
	return p, err
}

// Claim moves pending → processing, stamping processing_at. The mutex before
// any money posts.
func (r *Repository) Claim(ctx context.Context, id string) (*Payout, error) {
	return r.transition(ctx, id, StatusPending, StatusProcessing, `, processing_at = NOW()`)
}

// RevertToPending moves processing → pending and clears processing_at — the
// compensation when the debit posting failed (the payout never really left).
func (r *Repository) RevertToPending(ctx context.Context, id string) (*Payout, error) {
	return r.transition(ctx, id, StatusProcessing, StatusPending, `, processing_at = NULL`)
}

// MarkCompleted moves processing → completed and records the rail's id.
func (r *Repository) MarkCompleted(ctx context.Context, id, externalID string) (*Payout, error) {
	return r.transition(ctx, id, StatusProcessing, StatusCompleted,
		`, completed_at = NOW(), external_id = COALESCE(NULLIF($4, ''), external_id)`, externalID)
}

// MarkFailed moves processing → failed and records the rejection reason. This
// is the CLAIM for a rejection: it runs before the refund posting so that, of
// two workers reacting to the rail, only the one that wins this guarded UPDATE
// performs the refund (a concurrent worker that saw "completed" wins
// MarkCompleted instead and this returns ErrBadTransition).
func (r *Repository) MarkFailed(ctx context.Context, id, externalID, reason string) (*Payout, error) {
	return r.transition(ctx, id, StatusProcessing, StatusFailed,
		`, failed_at = NOW(),
		   external_id = COALESCE(NULLIF($4, ''), external_id),
		   failure_reason = NULLIF($5, '')`, externalID, reason)
}

// UnclaimFailed reverts failed → processing (clearing the failure stamps) when
// the refund posting that should have followed MarkFailed did not succeed. This
// keeps the money-owed payout in `processing`, where the poller will retry the
// refund, instead of stranding it in a terminal `failed` state with funds still
// held in SYSTEM:EXTERNAL.
func (r *Repository) UnclaimFailed(ctx context.Context, id string) (*Payout, error) {
	return r.transition(ctx, id, StatusFailed, StatusProcessing,
		`, failed_at = NULL, failure_reason = NULL`)
}

// SetExternalID records the rail's id without changing status (a payout the
// rail accepted but has not yet settled — RailPending).
func (r *Repository) SetExternalID(ctx context.Context, id, externalID string) error {
	_, err := r.db.Exec(ctx,
		`UPDATE payouts SET external_id = $2, updated_at = NOW()
		 WHERE id = $1::uuid AND status = 'processing'`, id, externalID)
	return err
}

// WalletBalance reads the cached balance for the currency — a pre-check; the
// ledger posting re-locks the row and is the final word (same discipline as
// transfers/escrow).
func (r *Repository) WalletBalance(ctx context.Context, userID, currency string) (int64, error) {
	col := "balance_crc"
	if currency == "USD" {
		col = "balance_usd"
	}
	var bal int64
	err := r.db.QueryRow(ctx,
		`SELECT `+col+` FROM wallets WHERE user_id = $1::uuid`, userID).Scan(&bal)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, nil
	}
	return bal, err
}
