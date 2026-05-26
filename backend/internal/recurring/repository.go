package recurring

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

func (r *Repository) FindByUserID(ctx context.Context, userID string) ([]RecurringPaymentRecord, error) {
	rows, err := r.db.Query(ctx,
		`SELECT id, user_id, label, type, amount,
		 COALESCE(currency, 'CRC'), frequency,
		 next_date::TEXT, last_paid_date::TEXT,
		 COALESCE(recipient_phone, ''), COALESCE(recipient_name, ''),
		 COALESCE(service_provider_id, ''), COALESCE(client_id, ''),
		 enabled, created_at, updated_at
		 FROM recurring_payments WHERE user_id = $1 ORDER BY next_date ASC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var payments []RecurringPaymentRecord
	for rows.Next() {
		var p RecurringPaymentRecord
		var lastPaid *string
		if err := rows.Scan(&p.ID, &p.UserID, &p.Label, &p.Type, &p.Amount,
			&p.Currency, &p.Frequency, &p.NextDate, &lastPaid,
			&p.RecipientPhone, &p.RecipientName,
			&p.ServiceProviderID, &p.ClientID,
			&p.Enabled, &p.CreatedAt, &p.UpdatedAt); err != nil {
			return nil, err
		}
		p.LastPaidDate = lastPaid
		payments = append(payments, p)
	}
	return payments, nil
}

func (r *Repository) Create(ctx context.Context, p *RecurringPaymentRecord) error {
	return r.db.QueryRow(ctx,
		`INSERT INTO recurring_payments
		 (user_id, label, type, amount, currency, frequency, next_date,
		  recipient_phone, recipient_name, service_provider_id, client_id)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, NULLIF($8, ''), NULLIF($9, ''), NULLIF($10, ''), NULLIF($11, ''))
		 RETURNING id, created_at, updated_at`,
		p.UserID, p.Label, p.Type, p.Amount, p.Currency, p.Frequency, p.NextDate,
		p.RecipientPhone, p.RecipientName, p.ServiceProviderID, p.ClientID,
	).Scan(&p.ID, &p.CreatedAt, &p.UpdatedAt)
}

func (r *Repository) Update(ctx context.Context, id, userID string, req *UpdateRecurringRequest) error {
	result, err := r.db.Exec(ctx,
		`UPDATE recurring_payments SET
		 label = COALESCE($3, label),
		 amount = COALESCE($4, amount),
		 frequency = COALESCE($5, frequency),
		 next_date = COALESCE($6::DATE, next_date),
		 updated_at = NOW()
		 WHERE id = $1 AND user_id = $2`,
		id, userID, req.Label, req.Amount, req.Frequency, req.NextDate)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return fmt.Errorf("recurring payment not found")
	}
	return nil
}

func (r *Repository) Delete(ctx context.Context, id, userID string) error {
	result, err := r.db.Exec(ctx,
		`DELETE FROM recurring_payments WHERE id = $1 AND user_id = $2`, id, userID)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return fmt.Errorf("recurring payment not found")
	}
	return nil
}

func (r *Repository) ToggleEnabled(ctx context.Context, id, userID string) (bool, error) {
	var enabled bool
	err := r.db.QueryRow(ctx,
		`UPDATE recurring_payments SET enabled = NOT enabled, updated_at = NOW()
		 WHERE id = $1 AND user_id = $2
		 RETURNING enabled`, id, userID).Scan(&enabled)
	if err != nil {
		return false, fmt.Errorf("recurring payment not found")
	}
	return enabled, nil
}

func (r *Repository) MarkPaid(ctx context.Context, id, userID string) (*RecurringPaymentRecord, error) {
	// Advance next_date based on frequency
	var p RecurringPaymentRecord
	var lastPaid *string
	err := r.db.QueryRow(ctx,
		`UPDATE recurring_payments SET
		 last_paid_date = CURRENT_DATE,
		 next_date = CASE frequency
		   WHEN 'weekly' THEN next_date + INTERVAL '7 days'
		   WHEN 'biweekly' THEN next_date + INTERVAL '14 days'
		   ELSE next_date + INTERVAL '1 month'
		 END,
		 updated_at = NOW()
		 WHERE id = $1 AND user_id = $2
		 RETURNING id, user_id, label, type, amount,
		   COALESCE(currency, 'CRC'), frequency,
		   next_date::TEXT, last_paid_date::TEXT,
		   COALESCE(recipient_phone, ''), COALESCE(recipient_name, ''),
		   COALESCE(service_provider_id, ''), COALESCE(client_id, ''),
		   enabled, created_at, updated_at`,
		id, userID).Scan(&p.ID, &p.UserID, &p.Label, &p.Type, &p.Amount,
		&p.Currency, &p.Frequency, &p.NextDate, &lastPaid,
		&p.RecipientPhone, &p.RecipientName,
		&p.ServiceProviderID, &p.ClientID,
		&p.Enabled, &p.CreatedAt, &p.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("recurring payment not found")
	}
	p.LastPaidDate = lastPaid
	return &p, nil
}
