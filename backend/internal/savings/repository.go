package savings

import (
	"context"
	"fmt"
	"hash/fnv"

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

// DeductSaved atomically decrements saved_minor by amount, but ONLY if the goal
// currently holds at least that much. Returns the updated goal, or an error when
// the amount exceeds what is saved (0 rows). This is the authoritative gate for
// withdrawals: because the check and the decrement are one atomic UPDATE,
// concurrent withdrawals cannot both pass and double-spend a goal's balance.
func (r *Repository) DeductSaved(ctx context.Context, id, userID string, amount int64) (*Goal, error) {
	g, err := scanGoal(r.db.QueryRow(ctx,
		`UPDATE savings_goals SET saved_minor = saved_minor - $3
		 WHERE id = $1 AND user_id = $2 AND saved_minor >= $3 RETURNING `+goalCols,
		id, userID, amount))
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, fmt.Errorf("amount exceeds amount saved")
		}
		return nil, err
	}
	return g, nil
}

// AcquireUserSavingsLock takes a session-level advisory lock keyed by the user
// so a deposit/withdraw and its ledger posting form one critical section per
// user. The returned function MUST be called to release the lock and connection.
func (r *Repository) AcquireUserSavingsLock(ctx context.Context, userID string) (func(), error) {
	conn, err := r.db.Acquire(ctx)
	if err != nil {
		return nil, fmt.Errorf("acquire conn: %w", err)
	}
	key := advisoryKey("savings:move", userID)
	if _, err := conn.Exec(ctx, `SELECT pg_advisory_lock($1)`, key); err != nil {
		conn.Release()
		return nil, fmt.Errorf("advisory lock: %w", err)
	}
	return func() {
		// Detached context so the unlock runs even if the request ctx was cancelled.
		_, _ = conn.Exec(context.Background(), `SELECT pg_advisory_unlock($1)`, key)
		conn.Release()
	}, nil
}

func advisoryKey(namespace, id string) int64 {
	h := fnv.New64a()
	_, _ = h.Write([]byte(namespace + ":" + id))
	return int64(h.Sum64()) // #nosec G115 -- advisory-lock key; any int64 value is valid for pg_advisory_lock
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
