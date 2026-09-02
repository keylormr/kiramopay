package user

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Repository struct {
	db *pgxpool.Pool
}

func NewRepository(db *pgxpool.Pool) *Repository {
	return &Repository{db: db}
}

// GetPlan returns the user's billing plan (free/plus/pro). A lightweight lookup
// that avoids the full PII-decrypting user select — used by the assistant quota
// to size the per-plan daily limit. Defaults to 'free' if the column is null.
func (r *Repository) GetPlan(ctx context.Context, userID string) (string, error) {
	var plan string
	if err := r.db.QueryRow(ctx,
		`SELECT COALESCE(plan, 'free') FROM users WHERE id = $1 AND deleted_at IS NULL`, userID,
	).Scan(&plan); err != nil {
		return "", err
	}
	return plan, nil
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
//
// POSITIONAL with scanUser below: add a column here and its &u.Field in the
// same slot there, or it compiles and fails at runtime.
const userSelectCols = `id, fn_pii_decrypt(cedula_enc), fn_pii_decrypt(phone_enc), phone_verified,
	        COALESCE(fn_pii_decrypt(email_enc), ''), email_verified,
	        first_name, last_name, birth_date, COALESCE(profile_picture_url, ''),
	        password_hash, biometric_enabled, kyc_level, COALESCE(kyc_status, 'pending'), status,
	        created_at, updated_at, last_login_at, referral_code`

func scanUser(row interface{ Scan(...any) error }) (*UserRecord, error) {
	u := &UserRecord{}
	err := row.Scan(
		&u.ID, &u.Cedula, &u.Phone, &u.PhoneVerified, &u.Email, &u.EmailVerified,
		&u.FirstName, &u.LastName, &u.BirthDate, &u.ProfilePictureURL,
		&u.PasswordHash, &u.BiometricEnabled, &u.KYCLevel, &u.KYCStatus, &u.Status,
		&u.CreatedAt, &u.UpdatedAt, &u.LastLoginAt, &u.ReferralCode,
	)
	return u, err
}

// maxReintentosCodigoReferido bounds how many fresh codes Create tries after a
// collision on uq_users_referral_code (probability ~1e-12 each).
const maxReintentosCodigoReferido = 3

// Create inserts the user. If u.ReferralCode is empty a fresh one is generated
// and, on a collision with uq_users_referral_code ONLY, regenerated up to
// maxReintentosCodigoReferido times. Any other unique violation (cedula_hash,
// phone_hash) is returned at once, as before. A caller-supplied code that
// collides is NOT replaced: that is the caller's intent, so it errors.
func (r *Repository) Create(ctx context.Context, u *UserRecord) error {
	generar := u.ReferralCode == ""
	for intento := 0; ; intento++ {
		if generar {
			u.ReferralCode = NewReferralCode()
		}
		// PII is encrypted at rest: cedula/phone/email are written via fn_pii_encrypt
		// with searchable fn_pii_hmac tokens; no plaintext PII column is stored.
		// referred_by is a *string: nil -> NULL (no attribution).
		_, err := r.db.Exec(ctx,
			`INSERT INTO users (id, cedula_enc, cedula_hash, phone_enc, phone_hash, phone_verified,
			        first_name, last_name, email_enc, email_hash, email_verified, password_hash, status, kyc_level, kyc_status,
			        referral_code, referred_by)
			 VALUES ($1, fn_pii_encrypt($2), fn_pii_hmac($2), fn_pii_encrypt($3), fn_pii_hmac($3), $4,
			         $5, $6, fn_pii_encrypt(NULLIF($7,'')), fn_pii_hmac(NULLIF($7,'')), $8, $9, $10, $11, 'pending',
			         $12, $13)`,
			u.ID, u.Cedula, u.Phone, u.PhoneVerified, u.FirstName, u.LastName, u.Email, u.EmailVerified, u.PasswordHash, u.Status, u.KYCLevel,
			u.ReferralCode, u.ReferredBy,
		)
		if err == nil {
			return nil
		}
		if generar && intento < maxReintentosCodigoReferido && isReferralCodeCollision(err) {
			continue
		}
		return fmt.Errorf("insert user: %w", err)
	}
}

// isReferralCodeCollision reports a unique violation on the referral code
// index specifically; duplicates of cedula/phone must NOT be retried.
func isReferralCodeCollision(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505" && pgErr.ConstraintName == "uq_users_referral_code"
}

// FindByReferralCode busca por codigo YA normalizado. Solo cuentas activas y
// no borradas: el codigo de una cuenta suspendida se trata como inexistente.
func (r *Repository) FindByReferralCode(ctx context.Context, code string) (*UserRecord, error) {
	u, err := scanUser(r.db.QueryRow(ctx,
		`SELECT `+userSelectCols+` FROM users WHERE referral_code = $1 AND status = 'active' AND deleted_at IS NULL`, code))
	if err != nil {
		return nil, fmt.Errorf("find user by referral code: %w", err)
	}
	return u, nil
}

// CountReferrals returns how many (non-deleted) accounts were registered with
// this user's referral code.
func (r *Repository) CountReferrals(ctx context.Context, userID string) (int, error) {
	var n int
	if err := r.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM users WHERE referred_by = $1 AND deleted_at IS NULL`, userID,
	).Scan(&n); err != nil {
		return 0, fmt.Errorf("count referrals: %w", err)
	}
	return n, nil
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

// FindByEmail returns the user record for a given email. Same HMAC lookup as
// FindByPhone; fn_pii_hmac already lower(trim)s, so the match is
// case-insensitive. Callers gate login on EmailVerified — an unverified email
// must never authenticate (the address is optional and editable).
func (r *Repository) FindByEmail(ctx context.Context, email string) (*UserRecord, error) {
	u, err := scanUser(r.db.QueryRow(ctx,
		`SELECT `+userSelectCols+` FROM users WHERE email_hash = fn_pii_hmac($1) AND deleted_at IS NULL`, email))
	if err != nil {
		return nil, fmt.Errorf("find user by email: %w", err)
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
		// Cambiar el correo BAJA email_verified: la verificacion probaba el
		// buzon anterior, no este. Sin esto, quien verifico un correo propio
		// podia apuntar su cuenta a un correo ajeno conservando el flag en true
		// y burlar el gate de login-por-correo (resolveLoginUser exige
		// email_verified). El correo nuevo no autentica hasta re-verificarlo.
		query += fmt.Sprintf(", email_enc = fn_pii_encrypt(NULLIF($%d,'')), email_hash = fn_pii_hmac(NULLIF($%d,'')), email_verified = false", argIdx, argIdx)
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
