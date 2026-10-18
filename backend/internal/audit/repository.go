package audit

import (
	"context"
	"encoding/json"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Repository handles audit log persistence.
type Repository struct {
	db *pgxpool.Pool
}

// NewRepository creates a new audit repository.
func NewRepository(db *pgxpool.Pool) *Repository {
	return &Repository{db: db}
}

// Insert writes a single audit event to the database.
func (r *Repository) Insert(ctx context.Context, evt *Event) error {
	return EscribirEnTx(ctx, r.db, evt)
}

// Ejecutor es lo que EscribirEnTx necesita: un pool o una transaccion.
type Ejecutor interface {
	Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error)
}

// EscribirEnTx escribe el evento con quien se le pase. Con una transaccion, el
// rastro queda o se va con ella. Lo usa lo que no puede quedar sin registro (el
// cierre de un comercio): el Logger escribe despues, en segundo plano, y
// descarta el evento si el buffer esta lleno.
func EscribirEnTx(ctx context.Context, q Ejecutor, evt *Event) error {
	details := "{}"
	if evt.Details != nil {
		b, err := json.Marshal(evt.Details)
		if err == nil {
			details = string(b)
		}
	}

	riskLevel := evt.RiskLevel
	if riskLevel == "" {
		riskLevel = "low"
	}

	_, err := q.Exec(ctx,
		`INSERT INTO audit_logs (user_id, action, resource_type, resource_id, ip_address, user_agent, details, risk_level)
		 VALUES ($1, $2, $3, $4, $5::INET, $6, $7::JSONB, $8)`,
		nilIfEmpty(evt.UserID),
		evt.Action,
		nilIfEmpty(evt.ResourceType),
		nilIfEmpty(evt.ResourceID),
		nilIfEmpty(evt.IPAddress),
		nilIfEmpty(evt.UserAgent),
		details,
		riskLevel,
	)
	return err
}

func nilIfEmpty(s string) interface{} {
	if s == "" {
		return nil
	}
	return s
}
