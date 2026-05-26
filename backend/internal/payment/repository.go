package payment

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Repository struct {
	db *pgxpool.Pool
}

func NewRepository(db *pgxpool.Pool) *Repository {
	return &Repository{db: db}
}

// Service Providers

func (r *Repository) GetProviderByCode(ctx context.Context, code string) (string, string, error) {
	var id, name string
	err := r.db.QueryRow(ctx,
		`SELECT id, name FROM service_providers WHERE code = $1 AND is_active = true`,
		code,
	).Scan(&id, &name)
	if err != nil {
		return "", "", fmt.Errorf("provider not found: %s", code)
	}
	return id, name, nil
}

// Saved Services

func (r *Repository) GetSavedServices(ctx context.Context, userID string) ([]SavedServiceRecord, error) {
	rows, err := r.db.Query(ctx,
		`SELECT ss.id, ss.user_id, sp.code, sp.name, ss.client_id, COALESCE(ss.nickname, ''), ss.auto_pay_enabled, ss.created_at
		 FROM saved_services ss
		 JOIN service_providers sp ON ss.provider_id = sp.id
		 WHERE ss.user_id = $1
		 ORDER BY ss.created_at DESC`,
		userID,
	)
	if err != nil {
		return nil, fmt.Errorf("query saved services: %w", err)
	}
	defer rows.Close()

	var services []SavedServiceRecord
	for rows.Next() {
		var s SavedServiceRecord
		if err := rows.Scan(&s.ID, &s.UserID, &s.ProviderCode, &s.ProviderName, &s.ClientID, &s.Nickname, &s.AutoPayEnabled, &s.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan service: %w", err)
		}
		services = append(services, s)
	}
	if services == nil {
		services = []SavedServiceRecord{}
	}
	return services, nil
}

func (r *Repository) AddSavedService(ctx context.Context, userID, providerID, clientID, nickname string) (*SavedServiceRecord, error) {
	id := uuid.New().String()
	_, err := r.db.Exec(ctx,
		`INSERT INTO saved_services (id, user_id, provider_id, client_id, nickname)
		 VALUES ($1, $2, $3, $4, $5)
		 ON CONFLICT (user_id, provider_id, client_id) DO NOTHING`,
		id, userID, providerID, clientID, nickname,
	)
	if err != nil {
		return nil, fmt.Errorf("add saved service: %w", err)
	}

	return &SavedServiceRecord{
		ID:       id,
		UserID:   userID,
		ClientID: clientID,
		Nickname: nickname,
	}, nil
}

// Payment History

func (r *Repository) GetPaymentHistory(ctx context.Context, userID string, limit int) ([]PaymentHistoryRecord, error) {
	if limit <= 0 {
		limit = 50
	}

	rows, err := r.db.Query(ctx,
		`SELECT id, user_id, type, provider_code, provider_name, client_id, amount, status, created_at
		 FROM payment_history WHERE user_id = $1
		 ORDER BY created_at DESC LIMIT $2`,
		userID, limit,
	)
	if err != nil {
		return nil, fmt.Errorf("query payment history: %w", err)
	}
	defer rows.Close()

	var history []PaymentHistoryRecord
	for rows.Next() {
		var h PaymentHistoryRecord
		if err := rows.Scan(&h.ID, &h.UserID, &h.Type, &h.ProviderCode, &h.ProviderName, &h.ClientID, &h.Amount, &h.Status, &h.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan payment: %w", err)
		}
		history = append(history, h)
	}
	if history == nil {
		history = []PaymentHistoryRecord{}
	}
	return history, nil
}

func (r *Repository) AddPaymentHistory(ctx context.Context, record *PaymentHistoryRecord) error {
	if record.ID == "" {
		record.ID = uuid.New().String()
	}
	if record.CreatedAt.IsZero() {
		record.CreatedAt = time.Now()
	}

	_, err := r.db.Exec(ctx,
		`INSERT INTO payment_history (id, user_id, type, provider_code, provider_name, client_id, amount, status, created_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
		record.ID, record.UserID, record.Type, record.ProviderCode, record.ProviderName,
		record.ClientID, record.Amount, record.Status, record.CreatedAt,
	)
	return err
}
