// Package plans registra el interes en los planes de pago. Hoy la aplicacion no
// puede cobrar — no hay pasarela ni suscripcion —, asi que lo unico honesto que
// se puede guardar es la intencion: quien dijo que quiere que plan y cuando.
// Registrar interes NO otorga el plan ni mueve dinero.
package plans

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kiramopay/backend/internal/audit"
)

// ErrPlanInvalid es cualquier plan que no sea uno de los dos de pago. El plan
// gratuito no se registra: no hay nada que contratar.
var ErrPlanInvalid = errors.New("plan invalido")

// planesDePago espeja chk_plan_interest_plan (migracion 056). Validar aqui
// tambien evita gastar un viaje a la base para recibir un error de constraint.
var planesDePago = map[string]bool{
	"negocio": true,
	"cima":    true,
}

const (
	defaultListLimit = 100
	maxListLimit     = 200
)

// ActorContext identifica la peticion para la auditoria.
type ActorContext struct{ IPAddress, UserAgent string }

// Interest es lo que se le devuelve a quien acaba de registrar su interes.
type Interest struct {
	Plan         string    `json:"plan"`
	RegisteredAt time.Time `json:"registered_at"`
}

// AdminInterest es la fila que ve un administrador. La PII sale enmascarada
// DESDE SQL, con las mismas expresiones que user.AdminUserView (vista
// users_masked de la migracion 041): el dato completo nunca llega al proceso.
type AdminInterest struct {
	UserID       string    `json:"user_id"`
	FirstName    string    `json:"first_name"`
	LastName     string    `json:"last_name"`
	CedulaMasked string    `json:"cedula_masked"`
	PhoneMasked  string    `json:"phone_masked"`
	EmailMasked  string    `json:"email_masked"`
	Plan         string    `json:"plan"`
	RegisteredAt time.Time `json:"registered_at"`
}

type Options struct{ AuditLogger *audit.Logger }

type Service struct {
	db          *pgxpool.Pool
	auditLogger *audit.Logger
}

func NewService(db *pgxpool.Pool, opts *Options) *Service {
	if opts == nil {
		opts = &Options{}
	}
	return &Service{db: db, auditLogger: opts.AuditLogger}
}

// Register anota el interes de una persona en un plan. Es idempotente por
// (user_id, plan): repetirlo no duplica la fila, solo refresca la fecha, que es
// la lectura util (cuando lo pidio por ultima vez).
func (s *Service) Register(ctx context.Context, userID, plan string, ac ActorContext) (*Interest, error) {
	if !planesDePago[plan] {
		return nil, ErrPlanInvalid
	}

	var out Interest
	if err := s.db.QueryRow(ctx,
		`INSERT INTO plan_interest (user_id, plan) VALUES ($1::uuid, $2)
		 ON CONFLICT (user_id, plan) DO UPDATE SET created_at = NOW()
		 RETURNING plan, created_at`,
		userID, plan,
	).Scan(&out.Plan, &out.RegisteredAt); err != nil {
		return nil, fmt.Errorf("register plan interest: %w", err)
	}

	// El plan no es PII y es justo lo que hay que poder auditar; el nombre y el
	// contacto NO van aqui: details es JSONB sin cifrar.
	s.audit(userID, ac, plan)
	return &out, nil
}

// listSelect enmascara en SQL: cedula deja los ultimos 3, telefono los ultimos
// 4, correo la primera letra y el dominio (expresiones de users_masked, 041).
//
// POSITIONAL con el Scan de List: agregar una columna aqui obliga a agregar su
// destino en la misma posicion alla.
//
// El filtro por deleted_at es el mismo de las demas listas administrativas: una
// cuenta dada de baja ya no es un cliente al que llamar.
const listSelect = `
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
	       p.plan, p.created_at
	  FROM plan_interest p
	  JOIN users u ON u.id = p.user_id
	 WHERE u.deleted_at IS NULL
	 ORDER BY p.created_at DESC
	 LIMIT $1`

// List devuelve quien mostro interes, lo mas reciente primero. Solo se monta
// dentro del grupo RequireAdmin.
func (s *Service) List(ctx context.Context, limit int) ([]AdminInterest, error) {
	rows, err := s.db.Query(ctx, listSelect, clampLimit(limit))
	if err != nil {
		return nil, fmt.Errorf("list plan interest: %w", err)
	}
	defer rows.Close()

	out := make([]AdminInterest, 0, 8)
	for rows.Next() {
		var v AdminInterest
		if err := rows.Scan(
			&v.UserID, &v.FirstName, &v.LastName,
			&v.CedulaMasked, &v.PhoneMasked, &v.EmailMasked,
			&v.Plan, &v.RegisteredAt,
		); err != nil {
			return nil, fmt.Errorf("scan plan interest: %w", err)
		}
		out = append(out, v)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate plan interest: %w", err)
	}
	return out, nil
}

func (s *Service) audit(userID string, ac ActorContext, plan string) {
	if s.auditLogger == nil {
		return
	}
	s.auditLogger.Log(audit.Event{
		UserID:       userID,
		Action:       "plan_interest",
		ResourceType: "plan",
		IPAddress:    ac.IPAddress,
		UserAgent:    ac.UserAgent,
		Details:      map[string]interface{}{"plan": plan},
		RiskLevel:    "low",
	})
}

func clampLimit(limit int) int {
	if limit <= 0 {
		return defaultListLimit
	}
	if limit > maxListLimit {
		return maxListLimit
	}
	return limit
}
