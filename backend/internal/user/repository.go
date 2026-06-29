package user

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Repository struct {
	db *pgxpool.Pool
}

func NewRepository(db *pgxpool.Pool) *Repository {
	return &Repository{db: db}
}

// IsAdmin reports whether the user has the admin role. Satisfies
// middleware.AdminChecker. Fail-closed: any error surfaces to the caller.
func (r *Repository) IsAdmin(ctx context.Context, userID string) (bool, error) {
	var role string
	if err := r.db.QueryRow(ctx,
		`SELECT role FROM users WHERE id = $1::uuid`, userID,
	).Scan(&role); err != nil {
		return false, err
	}
	return role == "admin", nil
}

// userSelectCols reads PII at rest: cedula/phone/email are stored encrypted
// (cedula_enc/phone_enc/email_enc, pgcrypto) and decrypted on read via the
// fn_pii_* helpers (migration 024); the searchable HMAC columns
// (cedula_hash/phone_hash) back the lookups. Decryption needs the
// kiramopay.encryption_key GUC, set per connection from PII_ENCRYPTION_KEY.
const userSelectCols = `id, fn_pii_decrypt(cedula_enc), fn_pii_decrypt(phone_enc), phone_verified,
	        COALESCE(fn_pii_decrypt(email_enc), ''), email_verified,
	        first_name, last_name, birth_date, COALESCE(profile_picture_url, ''),
	        password_hash, biometric_enabled, kyc_level, COALESCE(kyc_status, 'pending'), status,
	        created_at, updated_at, last_login_at`

func scanUser(row interface{ Scan(...any) error }) (*UserRecord, error) {
	u := &UserRecord{}
	err := row.Scan(
		&u.ID, &u.Cedula, &u.Phone, &u.PhoneVerified, &u.Email, &u.EmailVerified,
		&u.FirstName, &u.LastName, &u.BirthDate, &u.ProfilePictureURL,
		&u.PasswordHash, &u.BiometricEnabled, &u.KYCLevel, &u.KYCStatus, &u.Status,
		&u.CreatedAt, &u.UpdatedAt, &u.LastLoginAt,
	)
	return u, err
}

func (r *Repository) Create(ctx context.Context, u *UserRecord) error {
	// PII is encrypted at rest: cedula/phone/email are written via fn_pii_encrypt
	// with searchable fn_pii_hmac tokens; no plaintext PII column is stored.
	_, err := r.db.Exec(ctx,
		`INSERT INTO users (id, cedula_enc, cedula_hash, phone_enc, phone_hash,
		        first_name, last_name, email_enc, email_hash, password_hash, status, kyc_level, kyc_status)
		 VALUES ($1, fn_pii_encrypt($2), fn_pii_hmac($2), fn_pii_encrypt($3), fn_pii_hmac($3),
		         $4, $5, fn_pii_encrypt(NULLIF($6,'')), fn_pii_hmac(NULLIF($6,'')), $7, $8, $9, 'pending')`,
		u.ID, u.Cedula, u.Phone, u.FirstName, u.LastName, u.Email, u.PasswordHash, u.Status, u.KYCLevel,
	)
	if err != nil {
		return fmt.Errorf("insert user: %w", err)
	}
	return nil
}

func (r *Repository) FindByID(ctx context.Context, id string) (*UserRecord, error) {
	u, err := scanUser(r.db.QueryRow(ctx,
		`SELECT `+userSelectCols+` FROM users WHERE id = $1 AND deleted_at IS NULL`, id))
	if err != nil {
		return nil, fmt.Errorf("find user by id: %w", err)
	}
	return u, nil
}

func (r *Repository) FindByCedula(ctx context.Context, cedula string) (*UserRecord, error) {
	u, err := scanUser(r.db.QueryRow(ctx,
		`SELECT `+userSelectCols+` FROM users WHERE cedula_hash = fn_pii_hmac($1) AND deleted_at IS NULL`, cedula))
	if err != nil {
		return nil, fmt.Errorf("find user by cedula: %w", err)
	}
	return u, nil
}

// FindByPhone returns the user record for a given phone. The lookup uses the
// deterministic HMAC token so we never need the plaintext phone column.
func (r *Repository) FindByPhone(ctx context.Context, phone string) (*UserRecord, error) {
	u, err := scanUser(r.db.QueryRow(ctx,
		`SELECT `+userSelectCols+` FROM users WHERE phone_hash = fn_pii_hmac($1) AND deleted_at IS NULL`, phone))
	if err != nil {
		return nil, fmt.Errorf("find user by phone: %w", err)
	}
	return u, nil
}

func (r *Repository) UpdateLastLogin(ctx context.Context, id string) error {
	_, err := r.db.Exec(ctx,
		`UPDATE users SET last_login_at = NOW(), updated_at = NOW() WHERE id = $1`,
		id,
	)
	return err
}

func (r *Repository) UpdatePasswordHash(ctx context.Context, id string, passwordHash string) error {
	_, err := r.db.Exec(ctx,
		`UPDATE users SET password_hash = $2, updated_at = NOW() WHERE id = $1`,
		id, passwordHash,
	)
	return err
}

func (r *Repository) UpdateProfile(ctx context.Context, id string, req *UpdateProfileRequest) error {
	// Build dynamic update
	query := "UPDATE users SET updated_at = NOW()"
	args := []interface{}{id}
	argIdx := 2

	if req.FirstName != nil {
		query += fmt.Sprintf(", first_name = $%d", argIdx)
		args = append(args, *req.FirstName)
		argIdx++
	}
	if req.LastName != nil {
		query += fmt.Sprintf(", last_name = $%d", argIdx)
		args = append(args, *req.LastName)
		argIdx++
	}
	if req.Email != nil {
		query += fmt.Sprintf(", email_enc = fn_pii_encrypt(NULLIF($%d,'')), email_hash = fn_pii_hmac(NULLIF($%d,''))", argIdx, argIdx)
		args = append(args, *req.Email)
		argIdx++
	}
	if req.ProfilePictureURL != nil {
		query += fmt.Sprintf(", profile_picture_url = $%d", argIdx)
		args = append(args, *req.ProfilePictureURL)
		argIdx++
	}
	_ = argIdx // optional-field counter; final value intentionally unused

	query += " WHERE id = $1"
	_, err := r.db.Exec(ctx, query, args...)
	return err
}
