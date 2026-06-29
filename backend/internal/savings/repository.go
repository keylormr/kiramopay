package savings

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Repository struct {
	db *pgxpool.Pool
}

func NewRepository(db *pgxpool.Pool) *Repository {
	return &Repository{db: db}
}

const goalCols = `id, user_id, name, target_minor, saved_minor, currency, icon, color, created_at`

func scanGoal(row pgx.Row) (*Goal, error) {
	var g Goal
	if err := row.Scan(&g.ID, &g.UserID, &g.Name, &g.TargetMinor, &g.SavedMinor,
		&g.Currency, &g.Icon, &g.Color, &g.CreatedAt); err != nil {
		return nil, err
	}
	return &g, nil
}

func (r *Repository) ListByUser(ctx context.Context, userID string) ([]Goal, error) {
	rows, err := r.db.Query(ctx,
		`SELECT `+goalCols+` FROM savings_goals WHERE user_id = $1 ORDER BY created_at ASC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Goal
	for rows.Next() {
		g, err := scanGoal(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *g)
	}
	return out, rows.Err()
}

func (r *Repository) Create(ctx context.Context, g *Goal) error {
	return r.db.QueryRow(ctx,
		`INSERT INTO savings_goals (user_id, name, target_minor, currency, icon, color)
		 VALUES ($1, $2, $3, $4, $5, $6)
		 RETURNING id, saved_minor, created_at`,
		g.UserID, g.Name, g.TargetMinor, g.Currency, g.Icon, g.Color).Scan(&g.ID, &g.SavedMinor, &g.CreatedAt)
}

func (r *Repository) Get(ctx context.Context, id, userID string) (*Goal, error) {
	g, err := scanGoal(r.db.QueryRow(ctx,
		`SELECT `+goalCols+` FROM savings_goals WHERE id = $1 AND user_id = $2`, id, userID))
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, fmt.Errorf("goal not found")
		}
		return nil, err
	}
	return g, nil
}

func (r *Repository) Delete(ctx context.Context, id, userID string) error {
	res, err := r.db.Exec(ctx, `DELETE FROM savings_goals WHERE id = $1 AND user_id = $2`, id, userID)
	if err != nil {
		return err
	}
	if res.RowsAffected() == 0 {
		return fmt.Errorf("goal not found")
	}
	return nil
}

// AddSaved adjusts saved_minor by delta (positive deposit, negative withdraw) and
// returns the updated goal.
func (r *Repository) AddSaved(ctx context.Context, id, userID string, delta int64) (*Goal, error) {
	g, err := scanGoal(r.db.QueryRow(ctx,
		`UPDATE savings_goals SET saved_minor = saved_minor + $3
		 WHERE id = $1 AND user_id = $2 RETURNING `+goalCols, id, userID, delta))
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, fmt.Errorf("goal not found")
		}
		return nil, err
	}
	return g, nil
}

// WalletBalance returns the user's spendable balance in the given currency.
func (r *Repository) WalletBalance(ctx context.Context, userID, currency string) (int64, error) {
	q := `SELECT balance_crc FROM wallets WHERE user_id = $1::uuid`
	if currency == "USD" {
		q = `SELECT balance_usd FROM wallets WHERE user_id = $1::uuid`
	}
	var bal int64
	if err := r.db.QueryRow(ctx, q, userID).Scan(&bal); err != nil {
		return 0, err
	}
	return bal, nil
}
