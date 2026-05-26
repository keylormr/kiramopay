package audit

import (
	"context"
	"encoding/json"

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

	_, err := r.db.Exec(ctx,
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
