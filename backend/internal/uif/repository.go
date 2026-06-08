package uif

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Repository struct {
	db *pgxpool.Pool
}

func NewRepository(db *pgxpool.Pool) *Repository {
	return &Repository{db: db}
}

// outgoingTypes are the transaction types that move value out of a wallet and
// therefore count toward the UIF daily aggregate.
const outgoingTypesSQL = `('sinpe_send','qr_payment','bill_payment','recharge','withdrawal','p2p_send','crypto_buy')`

// GetUserDailyOutgoingTotal returns the sum of the user's completed outgoing
// transactions for `currency` so far TODAY (including any just-posted tx).
func (r *Repository) GetUserDailyOutgoingTotal(ctx context.Context, userID, currency string) (int64, error) {
	var total int64
	err := r.db.QueryRow(ctx,
		`SELECT COALESCE(SUM(amount), 0) FROM transactions
		 WHERE user_id = $1::uuid AND currency = $2 AND status = 'completed'
		   AND created_at::date = CURRENT_DATE
		   AND type IN `+outgoingTypesSQL,
		userID, currency,
	).Scan(&total)
	return total, err
}

// CreateReport inserts a report. A single_threshold/structuring report for the
// same tx is deduplicated by the partial unique index (ON CONFLICT DO NOTHING).
func (r *Repository) CreateReport(ctx context.Context, rep *Report) error {
	if rep.ID == "" {
		rep.ID = uuid.New().String()
	}
	if rep.Status == "" {
		rep.Status = StatusPending
	}
	_, err := r.db.Exec(ctx,
		`INSERT INTO uif_reports
		   (id, user_id, tx_id, report_type, amount_minor, currency, daily_total_minor, reason, status)
		 VALUES ($1::uuid, $2::uuid, NULLIF($3,'')::uuid, $4, $5, $6, $7, $8, $9)
		 ON CONFLICT (tx_id, report_type) WHERE tx_id IS NOT NULL DO NOTHING`,
		rep.ID, rep.UserID, rep.TxID, rep.ReportType, rep.AmountMinor,
		rep.Currency, rep.DailyTotalMinor, rep.Reason, rep.Status,
	)
	return err
}

const reportCols = `id::text, user_id::text, COALESCE(tx_id::text,''), report_type,
	amount_minor, currency, daily_total_minor, reason, status,
	COALESCE(reviewer_id::text,''), COALESCE(reviewer_notes,''), created_at, reviewed_at`

func scanReport(row pgx.Row) (*Report, error) {
	rep := &Report{}
	if err := row.Scan(
		&rep.ID, &rep.UserID, &rep.TxID, &rep.ReportType, &rep.AmountMinor,
		&rep.Currency, &rep.DailyTotalMinor, &rep.Reason, &rep.Status,
		&rep.ReviewerID, &rep.ReviewerNotes, &rep.CreatedAt, &rep.ReviewedAt,
	); err != nil {
		return nil, err
	}
	return rep, nil
}

func (r *Repository) GetReport(ctx context.Context, id string) (*Report, error) {
	return scanReport(r.db.QueryRow(ctx,
		`SELECT `+reportCols+` FROM uif_reports WHERE id = $1::uuid`, id))
}

// ListByStatus returns reports filtered by status ("" = all), newest first.
func (r *Repository) ListByStatus(ctx context.Context, status string, limit int) ([]Report, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	q := `SELECT ` + reportCols + ` FROM uif_reports`
	args := []any{}
	if status != "" {
		q += ` WHERE status = $1`
		args = append(args, status)
	}
	q += fmt.Sprintf(` ORDER BY created_at DESC LIMIT %d`, limit)

	rows, err := r.db.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []Report{}
	for rows.Next() {
		rep, err := scanReport(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *rep)
	}
	return out, rows.Err()
}

// Review records a compliance decision (submitted/dismissed/reviewed).
func (r *Repository) Review(ctx context.Context, id, reviewerID, status, notes string) error {
	ct, err := r.db.Exec(ctx,
		`UPDATE uif_reports
		 SET status = $2, reviewer_id = NULLIF($3,'')::uuid, reviewer_notes = NULLIF($4,''),
		     reviewed_at = NOW()
		 WHERE id = $1::uuid AND status = 'pending'`,
		id, status, reviewerID, notes,
	)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return fmt.Errorf("report not found or already reviewed")
	}
	return nil
}
