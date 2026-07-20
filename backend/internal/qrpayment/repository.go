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

// UpdateCommission sets a merchant's commission rate (admin action) and returns
// the updated row.
// UpdateMerchantProfile rewrites the owner-editable fields of a merchant.
// `status` carries the (possibly re-set) verification status so a change of
// legal identity can send the merchant back for review in the same statement.
func (r *Repository) UpdateMerchantProfile(
	ctx context.Context,
	merchantID, name, description, category, cedula, cedulaType, legalName, status string,
) (*Merchant, error) {
	m, err := scanMerchant(r.db.QueryRow(ctx,
		`UPDATE qr_merchants
		    SET name                = $2,
		        description         = $3,
		        category            = $4,
		        cedula              = $5,
		        cedula_type         = $6,
		        legal_name          = $7,
		        verification_status = $8,
		        rejection_reason    = CASE WHEN $8 = 'pending' THEN '' ELSE rejection_reason END
		  WHERE id = $1
		  RETURNING `+merchantCols,
		merchantID, name, description, category, cedula, cedulaType, legalName, status))
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, fmt.Errorf("merchant not found")
		}
		return nil, err
	}
	return m, nil
}

func (r *Repository) UpdateCommission(ctx context.Context, merchantID string, bps int) (*Merchant, error) {
	m, err := scanMerchant(r.db.QueryRow(ctx,
		`UPDATE qr_merchants SET commission_bps = $2 WHERE id = $1 RETURNING `+merchantCols,
		merchantID, bps))
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
		`INSERT INTO qr_payment_codes (id, creator_id, type, amount, currency, merchant_id, location_id, note, qr_data, single_use, expires_at)
		 VALUES ($1, $2, $3, $4, $5, NULLIF($6, '')::uuid, NULLIF($7, '')::uuid, $8, $9, $10, $11)`,
		qr.ID, qr.CreatorID, qr.Type, qr.Amount, qr.Currency, qr.MerchantID, qr.LocationID,
		qr.Note, qr.QRData, qr.SingleUse, qr.ExpiresAt)
	return err
}

func (r *Repository) GetQRCodeByData(ctx context.Context, qrData string) (*QRPaymentCode, error) {
	var qr QRPaymentCode
	err := r.db.QueryRow(ctx,
		`SELECT id, creator_id, type, amount, currency, COALESCE(merchant_id::text, ''),
		 COALESCE(location_id::text, ''), COALESCE(note, ''), qr_data, single_use, used, expires_at, created_at
		 FROM qr_payment_codes WHERE qr_data = $1`, qrData).Scan(
		&qr.ID, &qr.CreatorID, &qr.Type, &qr.Amount, &qr.Currency, &qr.MerchantID,
		&qr.LocationID, &qr.Note, &qr.QRData, &qr.SingleUse, &qr.Used, &qr.ExpiresAt, &qr.CreatedAt)
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
		 COALESCE(location_id::text, ''), COALESCE(note, ''), qr_data, single_use, used, expires_at, created_at
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
			&qr.MerchantID, &qr.LocationID, &qr.Note, &qr.QRData, &qr.SingleUse, &qr.Used,
			&qr.ExpiresAt, &qr.CreatedAt); err != nil {
			return nil, err
		}
		codes = append(codes, qr)
	}
	return codes, rows.Err()
}

// ── QR Payments ──────────────────────────────────────────────────────────────

// paymentCols is the canonical column list (and order) for reading a
// QRPaymentRecord, shared by every payment query so the scan stays in sync.
const paymentCols = `id, qr_code_id, payer_id, receiver_id, COALESCE(merchant_id::text, ''),
	COALESCE(location_id::text, ''), COALESCE(collected_by::text, ''),
	amount, fee, currency, status, COALESCE(note, ''), COALESCE(tx_id, ''),
	created_at, completed_at`

func scanPayment(row pgx.Row) (*QRPaymentRecord, error) {
	var p QRPaymentRecord
	if err := row.Scan(&p.ID, &p.QRCodeID, &p.PayerID, &p.ReceiverID, &p.MerchantID,
		&p.LocationID, &p.CollectedBy,
		&p.Amount, &p.Fee, &p.Currency, &p.Status, &p.Note, &p.TxID,
		&p.CreatedAt, &p.CompletedAt); err != nil {
		return nil, err
	}
	return &p, nil
}

func collectPayments(rows pgx.Rows) ([]QRPaymentRecord, error) {
	var out []QRPaymentRecord
	for rows.Next() {
		p, err := scanPayment(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *p)
	}
	return out, rows.Err()
}

func (r *Repository) CreatePayment(ctx context.Context, p *QRPaymentRecord) error {
	_, err := r.db.Exec(ctx,
		`INSERT INTO qr_payments (id, qr_code_id, payer_id, receiver_id, merchant_id, location_id, collected_by, amount, fee, currency, status, note, tx_id)
		 VALUES ($1, $2, $3, $4, NULLIF($5, '')::uuid, NULLIF($6, '')::uuid, NULLIF($7, '')::uuid, $8, $9, $10, $11, $12, NULLIF($13, ''))`,
		p.ID, p.QRCodeID, p.PayerID, p.ReceiverID, p.MerchantID, p.LocationID, p.CollectedBy,
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

// GetPaymentByTxID returns the payment linked to a ledger transaction, used to
// keep ScanAndPay idempotent (a retried scan reuses the same transfer, so it
// must not insert a second history row).
func (r *Repository) GetPaymentByTxID(ctx context.Context, txID string) (*QRPaymentRecord, error) {
	return scanPayment(r.db.QueryRow(ctx,
		`SELECT `+paymentCols+` FROM qr_payments WHERE tx_id = $1`, txID))
}

func (r *Repository) GetUserPayments(ctx context.Context, userID string, limit int) ([]QRPaymentRecord, error) {
	rows, err := r.db.Query(ctx,
		`SELECT `+paymentCols+` FROM qr_payments WHERE payer_id = $1 OR receiver_id = $1
		 ORDER BY created_at DESC LIMIT $2`,
		userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return collectPayments(rows)
}

// GetMerchantPayments returns the shop's collected payments, newest first —
// the per-business sales feed. Regardless of WHO generated each charge (owner
// or staff), the whole team reads the same list; access is enforced by the
// service via roleFor.
func (r *Repository) GetMerchantPayments(ctx context.Context, merchantID string, limit int) ([]QRPaymentRecord, error) {
	rows, err := r.db.Query(ctx,
		`SELECT `+paymentCols+` FROM qr_payments WHERE merchant_id = $1::uuid
		 ORDER BY created_at DESC LIMIT $2`,
		merchantID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return collectPayments(rows)
}

// ── Team: staff, locations, catalog (phase 3) ────────────────────────────────

// GetStaffRole returns the ACTIVE staff role a user holds on a merchant, or ""
// if they are not (or no longer) on the team. The owner never has a staff row;
// resolve ownership from qr_merchants.user_id first.
func (r *Repository) GetStaffRole(ctx context.Context, merchantID, userID string) (string, error) {
	var role string
	err := r.db.QueryRow(ctx,
		`SELECT role FROM merchant_staff
		  WHERE merchant_id = $1::uuid AND user_id = $2::uuid AND status = 'active'`,
		merchantID, userID).Scan(&role)
	if err == pgx.ErrNoRows {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return role, nil
}

const staffCols = `s.id, s.merchant_id, s.user_id, u.first_name, u.last_name,
	s.role, s.status, COALESCE(s.location_id::text, ''), s.created_at, s.revoked_at`

func scanStaff(row pgx.Row) (*StaffMember, error) {
	var m StaffMember
	if err := row.Scan(&m.ID, &m.MerchantID, &m.UserID, &m.FirstName, &m.LastName,
		&m.Role, &m.Status, &m.LocationID, &m.CreatedAt, &m.RevokedAt); err != nil {
		return nil, err
	}
	return &m, nil
}

// ListStaff returns every staff row of a merchant (active first, then revoked).
func (r *Repository) ListStaff(ctx context.Context, merchantID string) ([]StaffMember, error) {
	rows, err := r.db.Query(ctx,
		`SELECT `+staffCols+` FROM merchant_staff s
		  JOIN users u ON u.id = s.user_id
		 WHERE s.merchant_id = $1::uuid
		 ORDER BY (s.status = 'active') DESC, s.created_at ASC`, merchantID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []StaffMember
	for rows.Next() {
		m, err := scanStaff(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *m)
	}
	return out, rows.Err()
}

// UpsertStaff adds a user to the team, or reactivates (and re-roles) them if a
// revoked row already exists — the UNIQUE (merchant_id, user_id) pair makes
// "add the same person again" an update, not a duplicate.
func (r *Repository) UpsertStaff(ctx context.Context, merchantID, userID, role, locationID, addedBy string) (*StaffMember, error) {
	var id string
	err := r.db.QueryRow(ctx,
		`INSERT INTO merchant_staff (merchant_id, user_id, role, status, location_id, added_by)
		 VALUES ($1::uuid, $2::uuid, $3, 'active', NULLIF($4, '')::uuid, $5::uuid)
		 ON CONFLICT (merchant_id, user_id) DO UPDATE
		   SET role = EXCLUDED.role, status = 'active',
		       location_id = EXCLUDED.location_id, revoked_at = NULL
		 RETURNING id::text`,
		merchantID, userID, role, locationID, addedBy).Scan(&id)
	if err != nil {
		return nil, err
	}
	return r.getStaffByID(ctx, id)
}

func (r *Repository) getStaffByID(ctx context.Context, staffID string) (*StaffMember, error) {
	return scanStaff(r.db.QueryRow(ctx,
		`SELECT `+staffCols+` FROM merchant_staff s
		  JOIN users u ON u.id = s.user_id
		 WHERE s.id = $1::uuid`, staffID))
}

// UpdateStaff changes an ACTIVE member's role and/or location assignment.
func (r *Repository) UpdateStaff(ctx context.Context, merchantID, staffID, role, locationID string) (*StaffMember, error) {
	var id string
	err := r.db.QueryRow(ctx,
		`UPDATE merchant_staff
		    SET role = $3, location_id = NULLIF($4, '')::uuid
		  WHERE id = $1::uuid AND merchant_id = $2::uuid AND status = 'active'
		  RETURNING id::text`,
		staffID, merchantID, role, locationID).Scan(&id)
	if err == pgx.ErrNoRows {
		return nil, fmt.Errorf("staff member not found")
	}
	if err != nil {
		return nil, err
	}
	return r.getStaffByID(ctx, id)
}

// RevokeStaff removes a member from the team. The row is kept for history and
// so a later re-add reactivates it.
func (r *Repository) RevokeStaff(ctx context.Context, merchantID, staffID string) error {
	res, err := r.db.Exec(ctx,
		`UPDATE merchant_staff SET status = 'revoked', revoked_at = NOW()
		  WHERE id = $1::uuid AND merchant_id = $2::uuid AND status = 'active'`,
		staffID, merchantID)
	if err != nil {
		return err
	}
	if res.RowsAffected() == 0 {
		return fmt.Errorf("staff member not found")
	}
	return nil
}

// GetMerchantsByStaffUserID returns the merchants a user works FOR (active
// staff rows), with the staff role attached — the businesses that show up in
// their profile switcher besides the ones they own.
func (r *Repository) GetMerchantsByStaffUserID(ctx context.Context, userID string) ([]Merchant, error) {
	rows, err := r.db.Query(ctx,
		`SELECT m.id, m.user_id, m.name, m.description, m.category, COALESCE(m.logo_url, ''),
		        m.qr_code, m.active, m.cedula, m.cedula_type, m.legal_name, m.verification_status,
		        m.rejection_reason, m.reviewed_at, m.commission_bps, m.created_at, s.role
		   FROM merchant_staff s
		   JOIN qr_merchants m ON m.id = s.merchant_id
		  WHERE s.user_id = $1::uuid AND s.status = 'active' AND m.active = TRUE
		  ORDER BY m.created_at ASC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Merchant
	for rows.Next() {
		var m Merchant
		if err := rows.Scan(&m.ID, &m.UserID, &m.Name, &m.Description, &m.Category, &m.LogoURL,
			&m.QRCode, &m.Active, &m.Cedula, &m.CedulaType, &m.LegalName, &m.VerificationStatus,
			&m.RejectionReason, &m.ReviewedAt, &m.CommissionBps, &m.CreatedAt, &m.Role); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// ── Locations ────────────────────────────────────────────────────────────────

const locationCols = `id, merchant_id, name, address, active, created_at`

func scanLocation(row pgx.Row) (*Location, error) {
	var l Location
	if err := row.Scan(&l.ID, &l.MerchantID, &l.Name, &l.Address, &l.Active, &l.CreatedAt); err != nil {
		return nil, err
	}
	return &l, nil
}

func (r *Repository) ListLocations(ctx context.Context, merchantID string) ([]Location, error) {
	rows, err := r.db.Query(ctx,
		`SELECT `+locationCols+` FROM merchant_locations
		 WHERE merchant_id = $1::uuid ORDER BY created_at ASC`, merchantID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Location
	for rows.Next() {
		l, err := scanLocation(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *l)
	}
	return out, rows.Err()
}

func (r *Repository) GetLocation(ctx context.Context, merchantID, locationID string) (*Location, error) {
	return scanLocation(r.db.QueryRow(ctx,
		`SELECT `+locationCols+` FROM merchant_locations
		 WHERE id = $1::uuid AND merchant_id = $2::uuid`, locationID, merchantID))
}

func (r *Repository) CreateLocation(ctx context.Context, merchantID, name, address string) (*Location, error) {
	return scanLocation(r.db.QueryRow(ctx,
		`INSERT INTO merchant_locations (merchant_id, name, address)
		 VALUES ($1::uuid, $2, $3)
		 RETURNING `+locationCols, merchantID, name, address))
}

func (r *Repository) UpdateLocation(ctx context.Context, merchantID, locationID, name, address string, active bool) (*Location, error) {
	l, err := scanLocation(r.db.QueryRow(ctx,
		`UPDATE merchant_locations SET name = $3, address = $4, active = $5
		  WHERE id = $1::uuid AND merchant_id = $2::uuid
		  RETURNING `+locationCols, locationID, merchantID, name, address, active))
	if err == pgx.ErrNoRows {
		return nil, fmt.Errorf("location not found")
	}
	return l, err
}

// ── Catalog ──────────────────────────────────────────────────────────────────

const catalogCols = `id, merchant_id, name, price_minor, currency, active, sort_order, created_at`

func scanCatalogItem(row pgx.Row) (*CatalogItem, error) {
	var c CatalogItem
	if err := row.Scan(&c.ID, &c.MerchantID, &c.Name, &c.PriceMinor, &c.Currency,
		&c.Active, &c.SortOrder, &c.CreatedAt); err != nil {
		return nil, err
	}
	return &c, nil
}

func (r *Repository) ListCatalog(ctx context.Context, merchantID string) ([]CatalogItem, error) {
	rows, err := r.db.Query(ctx,
		`SELECT `+catalogCols+` FROM merchant_catalog_items
		 WHERE merchant_id = $1::uuid ORDER BY sort_order ASC, created_at ASC`, merchantID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []CatalogItem
	for rows.Next() {
		c, err := scanCatalogItem(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *c)
	}
	return out, rows.Err()
}

func (r *Repository) CreateCatalogItem(ctx context.Context, merchantID, name string, priceMinor int64, currency string, sortOrder int) (*CatalogItem, error) {
	return scanCatalogItem(r.db.QueryRow(ctx,
		`INSERT INTO merchant_catalog_items (merchant_id, name, price_minor, currency, sort_order)
		 VALUES ($1::uuid, $2, $3, $4, $5)
		 RETURNING `+catalogCols, merchantID, name, priceMinor, currency, sortOrder))
}

func (r *Repository) UpdateCatalogItem(ctx context.Context, merchantID, itemID, name string, priceMinor int64, active bool, sortOrder int) (*CatalogItem, error) {
	c, err := scanCatalogItem(r.db.QueryRow(ctx,
		`UPDATE merchant_catalog_items
		    SET name = $3, price_minor = $4, active = $5, sort_order = $6
		  WHERE id = $1::uuid AND merchant_id = $2::uuid
		  RETURNING `+catalogCols, itemID, merchantID, name, priceMinor, active, sortOrder))
	if err == pgx.ErrNoRows {
		return nil, fmt.Errorf("catalog item not found")
	}
	return c, err
}

func (r *Repository) DeleteCatalogItem(ctx context.Context, merchantID, itemID string) error {
	res, err := r.db.Exec(ctx,
		`DELETE FROM merchant_catalog_items WHERE id = $1::uuid AND merchant_id = $2::uuid`,
		itemID, merchantID)
	if err != nil {
		return err
	}
	if res.RowsAffected() == 0 {
		return fmt.Errorf("catalog item not found")
	}
	return nil
}
