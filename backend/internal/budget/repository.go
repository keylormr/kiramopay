package budget

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

func (r *Repository) FindByUserID(ctx context.Context, userID string) ([]BudgetRecord, error) {
	rows, err := r.db.Query(ctx,
		`SELECT id, user_id, label, amount_limit, amount_spent,
		 COALESCE(currency, 'CRC'), COALESCE(icon, ''), COALESCE(color, ''),
		 COALESCE(period, 'monthly'), created_at, updated_at
		 FROM budgets WHERE user_id = $1 ORDER BY created_at ASC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var budgets []BudgetRecord
	for rows.Next() {
		var b BudgetRecord
		if err := rows.Scan(&b.ID, &b.UserID, &b.Label, &b.AmountLimit, &b.AmountSpent,
			&b.Currency, &b.Icon, &b.Color, &b.Period, &b.CreatedAt, &b.UpdatedAt); err != nil {
			return nil, err
		}
		budgets = append(budgets, b)
	}
	return budgets, nil
}

func (r *Repository) FindByID(ctx context.Context, id, userID string) (*BudgetRecord, error) {
	var b BudgetRecord
	err := r.db.QueryRow(ctx,
		`SELECT id, user_id, label, amount_limit, amount_spent,
		 COALESCE(currency, 'CRC'), COALESCE(icon, ''), COALESCE(color, ''),
		 COALESCE(period, 'monthly'), created_at, updated_at
		 FROM budgets WHERE id = $1 AND user_id = $2`, id, userID).Scan(
		&b.ID, &b.UserID, &b.Label, &b.AmountLimit, &b.AmountSpent,
		&b.Currency, &b.Icon, &b.Color, &b.Period, &b.CreatedAt, &b.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &b, nil
}

func (r *Repository) Create(ctx context.Context, b *BudgetRecord) error {
	return r.db.QueryRow(ctx,
		`INSERT INTO budgets (user_id, label, amount_limit, currency, icon, color, period)
		 VALUES ($1, $2, $3, $4, $5, $6, $7)
		 RETURNING id, created_at, updated_at`,
		b.UserID, b.Label, b.AmountLimit, b.Currency, b.Icon, b.Color, b.Period,
	).Scan(&b.ID, &b.CreatedAt, &b.UpdatedAt)
}

func (r *Repository) Update(ctx context.Context, id, userID string, req *UpdateBudgetRequest) error {
	result, err := r.db.Exec(ctx,
		`UPDATE budgets SET
		 label = COALESCE($3, label),
		 amount_limit = COALESCE($4, amount_limit),
		 amount_spent = COALESCE($5, amount_spent),
		 icon = COALESCE($6, icon),
		 color = COALESCE($7, color),
		 updated_at = NOW()
		 WHERE id = $1 AND user_id = $2`,
		id, userID, req.Label, req.AmountLimit, req.AmountSpent, req.Icon, req.Color)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return fmt.Errorf("budget not found")
	}
	return nil
}

func (r *Repository) Delete(ctx context.Context, id, userID string) error {
	result, err := r.db.Exec(ctx,
		`DELETE FROM budgets WHERE id = $1 AND user_id = $2`, id, userID)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return fmt.Errorf("budget not found")
	}
	return nil
}

func (r *Repository) ResetAllSpent(ctx context.Context, userID string) error {
	_, err := r.db.Exec(ctx,
		`UPDATE budgets SET amount_spent = 0, updated_at = NOW() WHERE user_id = $1`, userID)
	return err
}
