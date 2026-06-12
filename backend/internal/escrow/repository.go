package escrow

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Repository persists escrow agreements.
type Repository struct {
	db *pgxpool.Pool
}

func NewRepository(db *pgxpool.Pool) *Repository {
	return &Repository{db: db}
}

const agreementCols = `
	id::text, buyer_id::text, seller_id::text, amount_minor, currency, status,
	description, COALESCE(dispute_reason, ''),
	funded_at, released_at, refunded_at, disputed_at, cancelled_at,
	created_at, updated_at`

func scanAgreement(row pgx.Row) (*Agreement, error) {
	var a Agreement
	err := row.Scan(
		&a.ID, &a.BuyerID, &a.SellerID, &a.AmountMinor, &a.Currency, &a.Status,
		&a.Description, &a.DisputeReason,
		&a.FundedAt, &a.ReleasedAt, &a.RefundedAt, &a.DisputedAt, &a.CancelledAt,
		&a.CreatedAt, &a.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &a, nil
}

func (r *Repository) Create(ctx context.Context, buyerID string, req *CreateRequest) (*Agreement, error) {
	row := r.db.QueryRow(ctx, `
		INSERT INTO escrow_agreements (buyer_id, seller_id, amount_minor, currency, description)
		VALUES ($1::uuid, $2::uuid, $3, $4, $5)
		RETURNING `+agreementCols,
		buyerID, req.SellerID, req.AmountMinor, req.Currency, req.Description,
	)
	return scanAgreement(row)
}

func (r *Repository) Get(ctx context.Context, id string) (*Agreement, error) {
	row := r.db.QueryRow(ctx,
		`SELECT `+agreementCols+` FROM escrow_agreements WHERE id = $1::uuid`, id)
	return scanAgreement(row)
}

// ListByUser returns agreements where the user is buyer or seller, newest first.
func (r *Repository) ListByUser(ctx context.Context, userID string, limit int) ([]Agreement, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	rows, err := r.db.Query(ctx,
		`SELECT `+agreementCols+` FROM escrow_agreements
		 WHERE buyer_id = $1::uuid OR seller_id = $1::uuid
		 ORDER BY created_at DESC LIMIT $2`, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]Agreement, 0, limit)
	for rows.Next() {
		a, err := scanAgreement(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *a)
	}
	return out, rows.Err()
}

// Transition atomically moves an agreement from → to, stamping the matching
// timestamp column. Returns ErrBadTransition if the row was not in `from`
// (someone else transitioned it first) — this is the concurrency guard.
func (r *Repository) Transition(ctx context.Context, id string, from, to Status, disputeReason string) (*Agreement, error) {
	var stamp string
	switch to {
	case StatusFunded:
		stamp = "funded_at = NOW(),"
	case StatusReleased:
		stamp = "released_at = NOW(),"
	case StatusRefunded:
		stamp = "refunded_at = NOW(),"
	case StatusDisputed:
		stamp = "disputed_at = NOW(),"
	case StatusCancelled:
		stamp = "cancelled_at = NOW(),"
	case StatusPending:
		// Compensating revert (e.g. a failed funding posting): clear the stamp
		// the forward transition wrote.
		stamp = "funded_at = NULL,"
	default:
		return nil, fmt.Errorf("escrow: unknown status %q", to)
	}
	row := r.db.QueryRow(ctx, `
		UPDATE escrow_agreements
		   SET status = $3, `+stamp+` updated_at = NOW(),
		       dispute_reason = COALESCE(NULLIF($4, ''), dispute_reason)
		 WHERE id = $1::uuid AND status = $2
		 RETURNING `+agreementCols,
		id, from, to, disputeReason,
	)
	a, err := scanAgreement(row)
	if errors.Is(err, ErrNotFound) {
		// Row exists but not in `from` (or doesn't exist at all) — disambiguate.
		if _, gerr := r.Get(ctx, id); gerr == nil {
			return nil, ErrBadTransition
		}
		return nil, ErrNotFound
	}
	return a, err
}

// WalletBalance reads the cached balance for the given currency. The ledger
// posting that follows re-locks the row, so this is a pre-check, not the
// final word (consistent with how transfers validate balance).
func (r *Repository) WalletBalance(ctx context.Context, userID, currency string) (int64, error) {
	col := "balance_crc"
	if currency == "USD" {
		col = "balance_usd"
	}
	var bal int64
	err := r.db.QueryRow(ctx,
		`SELECT `+col+` FROM wallets WHERE user_id = $1::uuid`, userID,
	).Scan(&bal)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, nil
	}
	return bal, err
}
