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

func (r *Repository) Create(ctx context.Context, u *UserRecord) error {
	_, err := r.db.Exec(ctx,
		`INSERT INTO users (id, cedula, phone, first_name, last_name, email, password_hash, status, kyc_level, kyc_status)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending')`,
		u.ID, u.Cedula, u.Phone, u.FirstName, u.LastName, u.Email, u.PasswordHash, u.Status, u.KYCLevel,
	)
	if err != nil {
		return fmt.Errorf("insert user: %w", err)
	}
	return nil
}

func (r *Repository) FindByID(ctx context.Context, id string) (*UserRecord, error) {
	u := &UserRecord{}
	err := r.db.QueryRow(ctx,
		`SELECT id, cedula, phone, phone_verified, COALESCE(email, ''), email_verified,
		        first_name, last_name, birth_date, COALESCE(profile_picture_url, ''),
		        password_hash, biometric_enabled, kyc_level, COALESCE(kyc_status, 'pending'), status,
		        created_at, updated_at, last_login_at
		 FROM users WHERE id = $1 AND deleted_at IS NULL`,
		id,
	).Scan(
		&u.ID, &u.Cedula, &u.Phone, &u.PhoneVerified, &u.Email, &u.EmailVerified,
		&u.FirstName, &u.LastName, &u.BirthDate, &u.ProfilePictureURL,
		&u.PasswordHash, &u.BiometricEnabled, &u.KYCLevel, &u.KYCStatus, &u.Status,
		&u.CreatedAt, &u.UpdatedAt, &u.LastLoginAt,
	)
	if err != nil {
		return nil, fmt.Errorf("find user by id: %w", err)
	}
	return u, nil
}

func (r *Repository) FindByCedula(ctx context.Context, cedula string) (*UserRecord, error) {
	u := &UserRecord{}
	err := r.db.QueryRow(ctx,
		`SELECT id, cedula, phone, phone_verified, COALESCE(email, ''), email_verified,
		        first_name, last_name, birth_date, COALESCE(profile_picture_url, ''),
		        password_hash, biometric_enabled, kyc_level, COALESCE(kyc_status, 'pending'), status,
		        created_at, updated_at, last_login_at
		 FROM users WHERE cedula = $1 AND deleted_at IS NULL`,
		cedula,
	).Scan(
		&u.ID, &u.Cedula, &u.Phone, &u.PhoneVerified, &u.Email, &u.EmailVerified,
		&u.FirstName, &u.LastName, &u.BirthDate, &u.ProfilePictureURL,
		&u.PasswordHash, &u.BiometricEnabled, &u.KYCLevel, &u.KYCStatus, &u.Status,
		&u.CreatedAt, &u.UpdatedAt, &u.LastLoginAt,
	)
	if err != nil {
		return nil, fmt.Errorf("find user by cedula: %w", err)
	}
	return u, nil
}

// FindByPhone returns the user record for a given phone, normalising the
// input (strip whitespace) before lookup. Used by SINPE/QR to find peers.
func (r *Repository) FindByPhone(ctx context.Context, phone string) (*UserRecord, error) {
	u := &UserRecord{}
	err := r.db.QueryRow(ctx,
		`SELECT id, cedula, phone, phone_verified, COALESCE(email, ''), email_verified,
		        first_name, last_name, birth_date, COALESCE(profile_picture_url, ''),
		        password_hash, biometric_enabled, kyc_level, COALESCE(kyc_status, 'pending'), status,
		        created_at, updated_at, last_login_at
		 FROM users WHERE phone = $1 AND deleted_at IS NULL`,
		phone,
	).Scan(
		&u.ID, &u.Cedula, &u.Phone, &u.PhoneVerified, &u.Email, &u.EmailVerified,
		&u.FirstName, &u.LastName, &u.BirthDate, &u.ProfilePictureURL,
		&u.PasswordHash, &u.BiometricEnabled, &u.KYCLevel, &u.KYCStatus, &u.Status,
		&u.CreatedAt, &u.UpdatedAt, &u.LastLoginAt,
	)
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
		query += fmt.Sprintf(", email = $%d", argIdx)
		args = append(args, *req.Email)
		argIdx++
	}
	if req.ProfilePictureURL != nil {
		query += fmt.Sprintf(", profile_picture_url = $%d", argIdx)
		args = append(args, *req.ProfilePictureURL)
		argIdx++
	}

	query += " WHERE id = $1"
	_, err := r.db.Exec(ctx, query, args...)
	return err
}
