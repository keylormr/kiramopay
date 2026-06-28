package qrpayment

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Repository struct {
	db *pgxpool.Pool
}

func NewRepository(db *pgxpool.Pool) *Repository {
	return &Repository{db: db}
}

// ── Merchants ────────────────────────────────────────────────────────────────

// merchantCols is the canonical column list (and order) for reading a Merchant,
// shared by every merchant query so the scan helper stays in sync.
const merchantCols = `id, user_id, name, description, category, COALESCE(logo_url, ''),
	qr_code, active, cedula, cedula_type, legal_name, verification_status,
	rejection_reason, reviewed_at, commission_bps, created_at`

func scanMerchant(row pgx.Row) (*Merchant, error) {
	var m Merchant
	if err := row.Scan(&m.ID, &m.UserID, &m.Name, &m.Description, &m.Category, &m.LogoURL,
		&m.QRCode, &m.Active, &m.Cedula, &m.CedulaType, &m.LegalName, &m.VerificationStatus,
		&m.RejectionReason, &m.ReviewedAt, &m.CommissionBps, &m.CreatedAt); err != nil {
		return nil, err
	}
	return &m, nil
}

func (r *Repository) CreateMerchant(ctx context.Context, m *Merchant) error {
	_, err := r.db.Exec(ctx,
		`INSERT INTO qr_merchants (id, user_id, name, description, category, qr_code,
		 cedula, cedula_type, legal_name)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
		m.ID, m.UserID, m.Name, m.Description, m.Category, m.QRCode,
		m.Cedula, m.CedulaType, m.LegalName)
	return err
}

func (r *Repository) GetMerchant(ctx context.Context, merchantID string) (*Merchant, error) {
	return scanMerchant(r.db.QueryRow(ctx,
		`SELECT `+merchantCols+` FROM qr_merchants WHERE id = $1`, merchantID))
}

// GetMerchantsByUserID returns every merchant profile a user owns (a user may run
// several businesses).
func (r *Repository) GetMerchantsByUserID(ctx context.Context, userID string) ([]Merchant, error) {
	rows, err := r.db.Query(ctx,
		`SELECT `+merchantCols+` FROM qr_merchants WHERE user_id = $1 ORDER BY created_at ASC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return collectMerchants(rows)
}

func (r *Repository) GetMerchantByQRCode(ctx context.Context, qrCode string) (*Merchant, error) {
	return scanMerchant(r.db.QueryRow(ctx,
		`SELECT `+merchantCols+` FROM qr_merchants WHERE qr_code = $1 AND active = TRUE`, qrCode))
}

// ListPendingMerchants returns merchants awaiting admin review (oldest first).
func (r *Repository) ListPendingMerchants(ctx context.Context) ([]Merchant, error) {
	rows, err := r.db.Query(ctx,
		`SELECT `+merchantCols+` FROM qr_merchants
		 WHERE verification_status = 'pending' ORDER BY created_at ASC LIMIT 200`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return collectMerchants(rows)
}

// UpdateVerification flips a merchant's verification status (admin action) and
// returns the updated row.
func (r *Repository) UpdateVerification(ctx context.Context, merchantID, status, reviewedBy, reason string) (*Merchant, error) {
	m, err := scanMerchant(r.db.QueryRow(ctx,
		`UPDATE qr_merchants
		    SET verification_status = $2,
		        reviewed_by         = NULLIF($3, '')::uuid,
		        reviewed_at         = NOW(),
		        rejection_reason    = $4
		  WHERE id = $1
		  RETURNING `+merchantCols, merchantID, status, reviewedBy, reason))
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, fmt.Errorf("merchant not found")
		}
		return nil, err
	}
	return m, nil
}

func collectMerchants(rows pgx.Rows) ([]Merchant, error) {
	var out []Merchant
	for rows.Next() {
		m, err := scanMerchant(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *m)
	}
	return out, rows.Err()
}

// ── QR Codes ─────────────────────────────────────────────────────────────────

func (r *Repository) CreateQRCode(ctx context.Context, qr *QRPaymentCode) error {
	_, err := r.db.Exec(ctx,
		`INSERT INTO qr_payment_codes (id, creator_id, type, amount, currency, merchant_id, note, qr_data, single_use, expires_at)
		 VALUES ($1, $2, $3, $4, $5, NULLIF($6, ''), $7, $8, $9, $10)`,
		qr.ID, qr.CreatorID, qr.Type, qr.Amount, qr.Currency, qr.MerchantID,
		qr.Note, qr.QRData, qr.SingleUse, qr.ExpiresAt)
	return err
}

func (r *Repository) GetQRCodeByData(ctx context.Context, qrData string) (*QRPaymentCode, error) {
	var qr QRPaymentCode
	err := r.db.QueryRow(ctx,
		`SELECT id, creator_id, type, amount, currency, COALESCE(merchant_id::text, ''),
		 COALESCE(note, ''), qr_data, single_use, used, expires_at, created_at
		 FROM qr_payment_codes WHERE qr_data = $1`, qrData).Scan(
		&qr.ID, &qr.CreatorID, &qr.Type, &qr.Amount, &qr.Currency, &qr.MerchantID,
		&qr.Note, &qr.QRData, &qr.SingleUse, &qr.Used, &qr.ExpiresAt, &qr.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &qr, nil
}

func (r *Repository) MarkQRUsed(ctx context.Context, qrID string) error {
	_, err := r.db.Exec(ctx, `UPDATE qr_payment_codes SET used = TRUE WHERE id = $1`, qrID)
	return err
}

func (r *Repository) GetUserQRCodes(ctx context.Context, userID string) ([]QRPaymentCode, error) {
	rows, err := r.db.Query(ctx,
		`SELECT id, creator_id, type, amount, currency, COALESCE(merchant_id::text, ''),
		 COALESCE(note, ''), qr_data, single_use, used, expires_at, created_at
		 FROM qr_payment_codes WHERE creator_id = $1 ORDER BY created_at DESC LIMIT 50`,
		userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var codes []QRPaymentCode
	for rows.Next() {
		var qr QRPaymentCode
		if err := rows.Scan(&qr.ID, &qr.CreatorID, &qr.Type, &qr.Amount, &qr.Currency,
			&qr.MerchantID, &qr.Note, &qr.QRData, &qr.SingleUse, &qr.Used,
			&qr.ExpiresAt, &qr.CreatedAt); err != nil {
			return nil, err
		}
		codes = append(codes, qr)
	}
	return codes, rows.Err()
}

// ── QR Payments ──────────────────────────────────────────────────────────────

func (r *Repository) CreatePayment(ctx context.Context, p *QRPaymentRecord) error {
	_, err := r.db.Exec(ctx,
		`INSERT INTO qr_payments (id, qr_code_id, payer_id, receiver_id, merchant_id, amount, fee, currency, status, note, tx_id)
		 VALUES ($1, $2, $3, $4, NULLIF($5, ''), $6, $7, $8, $9, $10, NULLIF($11, ''))`,
		p.ID, p.QRCodeID, p.PayerID, p.ReceiverID, p.MerchantID,
		p.Amount, p.Fee, p.Currency, p.Status, p.Note, p.TxID)
	return err
}

func (r *Repository) UpdatePaymentStatus(ctx context.Context, paymentID, status, txID string) error {
	result, err := r.db.Exec(ctx,
		`UPDATE qr_payments SET status = $2, tx_id = NULLIF($3, ''),
		 completed_at = CASE WHEN $2 IN ('completed', 'failed', 'refunded') THEN NOW() ELSE completed_at END
		 WHERE id = $1`, paymentID, status, txID)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return fmt.Errorf("payment not found")
	}
	return nil
}

func (r *Repository) GetUserPayments(ctx context.Context, userID string, limit int) ([]QRPaymentRecord, error) {
	rows, err := r.db.Query(ctx,
		`SELECT id, qr_code_id, payer_id, receiver_id, COALESCE(merchant_id::text, ''),
		 amount, fee, currency, status, COALESCE(note, ''), COALESCE(tx_id, ''),
		 created_at, completed_at
		 FROM qr_payments WHERE payer_id = $1 OR receiver_id = $1
		 ORDER BY created_at DESC LIMIT $2`,
		userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var payments []QRPaymentRecord
	for rows.Next() {
		var p QRPaymentRecord
		if err := rows.Scan(&p.ID, &p.QRCodeID, &p.PayerID, &p.ReceiverID, &p.MerchantID,
			&p.Amount, &p.Fee, &p.Currency, &p.Status, &p.Note, &p.TxID,
			&p.CreatedAt, &p.CompletedAt); err != nil {
			return nil, err
		}
		payments = append(payments, p)
	}
	return payments, rows.Err()
}
