package user

import (
	"context"
	"fmt"
	"strings"
	"time"
)

// AdminUserView es la ficha que ve un administrador en /admin/users/*. La PII
// sale enmascarada DESDE SQL (mismas expresiones que la vista users_masked de
// la migracion 041): el dato completo nunca llega al proceso ni al cliente.
type AdminUserView struct {
	ID            string     `json:"id"`
	FirstName     string     `json:"first_name"`
	LastName      string     `json:"last_name"`
	CedulaMasked  string     `json:"cedula_masked"`
	PhoneMasked   string     `json:"phone_masked"`
	EmailMasked   string     `json:"email_masked"`
	Status        string     `json:"status"`
	Role          string     `json:"role"`
	KYCLevel      int        `json:"kyc_level"`
	CreatedAt     time.Time  `json:"created_at"`
	LastLoginAt   *time.Time `json:"last_login_at"`
	BlockedAt     *time.Time `json:"blocked_at"`
	BlockedReason string     `json:"blocked_reason"`
	BlockedByName string     `json:"blocked_by_name"`
}

// Topes de las listas admin. El handler pasa el limit del query string; aqui
// se acota para que un 0 o un valor absurdo no devuelvan la tabla entera.
const (
	defaultAdminSearchLimit  = 20
	defaultAdminBlockedLimit = 50
	maxAdminListLimit        = 100
)

func clampAdminLimit(limit, fallback int) int {
	if limit <= 0 {
		return fallback
	}
	if limit > maxAdminListLimit {
		return maxAdminListLimit
	}
	return limit
}

// adminViewSelect enmascara en SQL: cedula deja los ultimos 3, telefono los
// ultimos 4, correo la primera letra y el dominio (expresiones de users_masked,
// 041). El LEFT JOIN resuelve el nombre de quien bloqueo.
//
// POSITIONAL con scanAdminView: agregar una columna aqui y su &v.Campo en la
// misma posicion alla, o compila y falla en tiempo de ejecucion.
const adminViewSelect = `
	SELECT u.id::text, u.first_name, u.last_name,
	       COALESCE(CASE WHEN fn_pii_decrypt(u.cedula_enc) IS NULL THEN NULL
	                ELSE repeat('•', GREATEST(length(fn_pii_decrypt(u.cedula_enc)) - 3, 0))
	                     || right(fn_pii_decrypt(u.cedula_enc), 3)
	                END, ''),
	       COALESCE(CASE WHEN fn_pii_decrypt(u.phone_enc) IS NULL THEN NULL
	                ELSE repeat('•', GREATEST(length(fn_pii_decrypt(u.phone_enc)) - 4, 0))
	                     || right(fn_pii_decrypt(u.phone_enc), 4)
	                END, ''),
	       COALESCE(CASE WHEN fn_pii_decrypt(u.email_enc) IS NULL THEN NULL
	                ELSE substring(fn_pii_decrypt(u.email_enc) from 1 for 1)
	                     || repeat('•', GREATEST(position('@' in fn_pii_decrypt(u.email_enc)) - 2, 0))
	                     || substring(fn_pii_decrypt(u.email_enc) from position('@' in fn_pii_decrypt(u.email_enc)))
	                END, ''),
	       COALESCE(u.status, 'active'), COALESCE(u.role, 'user'), COALESCE(u.kyc_level, 0),
	       COALESCE(u.created_at, NOW()), u.last_login_at,
	       u.blocked_at, COALESCE(u.blocked_reason, ''),
	       COALESCE(b.first_name || ' ' || b.last_name, '')
	  FROM users u
	  LEFT JOIN users b ON b.id = u.blocked_by`

func scanAdminView(row interface{ Scan(...any) error }) (*AdminUserView, error) {
	v := &AdminUserView{}
	err := row.Scan(
		&v.ID, &v.FirstName, &v.LastName,
		&v.CedulaMasked, &v.PhoneMasked, &v.EmailMasked,
		&v.Status, &v.Role, &v.KYCLevel,
		&v.CreatedAt, &v.LastLoginAt,
		&v.BlockedAt, &v.BlockedReason,
		&v.BlockedByName,
	)
	return v, err
}

func (r *Repository) queryAdminViews(ctx context.Context, sql string, args ...any) ([]AdminUserView, error) {
	rows, err := r.db.Query(ctx, sql, args...)
	if err != nil {
		return nil, fmt.Errorf("query admin views: %w", err)
	}
	defer rows.Close()
	out := make([]AdminUserView, 0, 8)
	for rows.Next() {
		v, err := scanAdminView(rows)
		if err != nil {
			return nil, fmt.Errorf("scan admin view: %w", err)
		}
		out = append(out, *v)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate admin views: %w", err)
	}
	return out, nil
}

// GetStatus devuelve users.status sin descifrar PII (misma idea que GetPlan).
// pgx.ErrNoRows si no existe o esta borrada.
func (r *Repository) GetStatus(ctx context.Context, userID string) (string, error) {
	var status string
	if err := r.db.QueryRow(ctx,
		`SELECT COALESCE(status, 'active') FROM users WHERE id = $1::uuid AND deleted_at IS NULL`, userID,
	).Scan(&status); err != nil {
		return "", err
	}
	return status, nil
}

// adminHashCols es la lista blanca de columnas HMAC consultables. La columna
// se interpola en el SQL, asi que jamas puede venir del cliente sin pasar por
// aqui.
var adminHashCols = map[string]bool{
	"cedula_hash": true,
	"phone_hash":  true,
	"email_hash":  true,
}

// FindAdminViewByHash busca por igualdad EXACTA sobre una columna HMAC. value
// debe venir ya canonicalizado por identifier.Classify (fn_pii_hmac solo hace
// lower/trim). cedula_hash y phone_hash son unicos; email_hash puede repetirse.
func (r *Repository) FindAdminViewByHash(ctx context.Context, col, value string) ([]AdminUserView, error) {
	if !adminHashCols[col] {
		return nil, fmt.Errorf("find admin view: unsupported column %q", col)
	}
	return r.queryAdminViews(ctx,
		adminViewSelect+` WHERE u.`+col+` = fn_pii_hmac($1) AND u.deleted_at IS NULL
		 ORDER BY u.created_at DESC LIMIT $2`,
		value, defaultAdminSearchLimit)
}

// likeEscaper neutraliza los comodines de LIKE en el termino del usuario: sin
// esto "%" listaria la tabla entera y "_" casaria cualquier letra. La barra va
// primero para no re-escapar las que agregan las otras dos reglas.
var likeEscaper = strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)

// SearchAdminViewByName busca por subcadena (sin distinguir mayusculas) en
// "nombre apellido". first_name/last_name son columnas planas, no PII cifrada.
func (r *Repository) SearchAdminViewByName(ctx context.Context, term string, limit int) ([]AdminUserView, error) {
	term = strings.TrimSpace(term)
	if term == "" {
		return []AdminUserView{}, nil
	}
	pattern := "%" + likeEscaper.Replace(term) + "%"
	return r.queryAdminViews(ctx,
		adminViewSelect+` WHERE u.deleted_at IS NULL
		   AND (u.first_name || ' ' || u.last_name) ILIKE $1 ESCAPE '\'
		 ORDER BY u.last_name, u.first_name, u.created_at LIMIT $2`,
		pattern, clampAdminLimit(limit, defaultAdminSearchLimit))
}

// GetAdminView devuelve la ficha de una cuenta. pgx.ErrNoRows (envuelto) si no
// existe o esta borrada.
func (r *Repository) GetAdminView(ctx context.Context, userID string) (*AdminUserView, error) {
	v, err := scanAdminView(r.db.QueryRow(ctx,
		adminViewSelect+` WHERE u.id = $1::uuid AND u.deleted_at IS NULL`, userID))
	if err != nil {
		return nil, fmt.Errorf("get admin view: %w", err)
	}
	return v, nil
}

// ListBlockedAdminViews lista las cuentas bloqueadas, la mas reciente primero
// (usa idx_users_blocked).
func (r *Repository) ListBlockedAdminViews(ctx context.Context, limit int) ([]AdminUserView, error) {
	return r.queryAdminViews(ctx,
		adminViewSelect+` WHERE u.status = 'blocked' AND u.deleted_at IS NULL
		 ORDER BY u.blocked_at DESC NULLS LAST, u.created_at DESC LIMIT $1`,
		clampAdminLimit(limit, defaultAdminBlockedLimit))
}
