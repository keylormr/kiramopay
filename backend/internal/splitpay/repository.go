package splitpay

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

// ── Split Groups ─────────────────────────────────────────────────────────────

// CrearGrupoConCuotas escribe el grupo y TODAS sus cuotas en una sola
// transaccion. Iban por separado: si la insercion de una cuota fallaba a mitad,
// quedaba un grupo cuyas cuotas no sumaban su total y que por lo tanto nadie
// podia liquidar nunca.
func (r *Repository) CrearGrupoConCuotas(ctx context.Context, group *SplitGroup, shares []SplitShare) error {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	if _, err := tx.Exec(ctx,
		`INSERT INTO split_groups (id, creator_id, title, description, total_amount, currency, split_type, status)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
		group.ID, group.CreatorID, group.Title, group.Description,
		group.TotalAmount, group.Currency, group.SplitType, group.Status); err != nil {
		return err
	}

	for i := range shares {
		sh := &shares[i]
		if _, err := tx.Exec(ctx,
			`INSERT INTO split_shares (id, group_id, user_id, user_phone, user_name, amount, status, paid_at)
			 VALUES ($1, $2, $3, NULLIF($4, ''), $5, $6, $7, CASE WHEN $7 = 'paid' THEN NOW() END)`,
			sh.ID, sh.GroupID, sh.UserID, sh.UserPhone,
			sh.UserName, sh.Amount, sh.Status); err != nil {
			return err
		}
	}

	return tx.Commit(ctx)
}

func (r *Repository) GetGroup(ctx context.Context, groupID string) (*SplitGroup, error) {
	var g SplitGroup
	err := r.db.QueryRow(ctx,
		`SELECT id, creator_id, title, COALESCE(description, ''), total_amount, currency,
		 split_type, status, created_at, settled_at
		 FROM split_groups WHERE id = $1`, groupID).Scan(
		&g.ID, &g.CreatorID, &g.Title, &g.Description, &g.TotalAmount, &g.Currency,
		&g.SplitType, &g.Status, &g.CreatedAt, &g.SettledAt)
	if err != nil {
		return nil, err
	}
	return &g, nil
}

func (r *Repository) UpdateGroupStatus(ctx context.Context, groupID, status string) error {
	query := `UPDATE split_groups SET status = $2 WHERE id = $1`
	if status == "settled" {
		query = `UPDATE split_groups SET status = $2, settled_at = NOW() WHERE id = $1`
	}
	result, err := r.db.Exec(ctx, query, groupID, status)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return fmt.Errorf("split group not found")
	}
	return nil
}

func (r *Repository) ListUserGroups(ctx context.Context, userID string) ([]SplitGroup, error) {
	rows, err := r.db.Query(ctx,
		`SELECT DISTINCT g.id, g.creator_id, g.title, COALESCE(g.description, ''),
		 g.total_amount, g.currency, g.split_type, g.status, g.created_at, g.settled_at
		 FROM split_groups g
		 LEFT JOIN split_shares s ON s.group_id = g.id
		 WHERE g.creator_id = $1 OR s.user_id = $1
		 ORDER BY g.created_at DESC LIMIT 50`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var groups []SplitGroup
	for rows.Next() {
		var g SplitGroup
		if err := rows.Scan(&g.ID, &g.CreatorID, &g.Title, &g.Description,
			&g.TotalAmount, &g.Currency, &g.SplitType, &g.Status,
			&g.CreatedAt, &g.SettledAt); err != nil {
			return nil, err
		}
		groups = append(groups, g)
	}
	return groups, nil
}

// ── Split Shares ─────────────────────────────────────────────────────────────

func (r *Repository) GetGroupShares(ctx context.Context, groupID string) ([]SplitShare, error) {
	rows, err := r.db.Query(ctx,
		`SELECT id, group_id, COALESCE(user_id::text, ''), COALESCE(user_phone, ''),
		 user_name, amount, status, paid_at
		 FROM split_shares WHERE group_id = $1 ORDER BY user_name`, groupID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var shares []SplitShare
	for rows.Next() {
		var s SplitShare
		if err := rows.Scan(&s.ID, &s.GroupID, &s.UserID, &s.UserPhone,
			&s.UserName, &s.Amount, &s.Status, &s.PaidAt); err != nil {
			return nil, err
		}
		shares = append(shares, s)
	}
	return shares, nil
}

func (r *Repository) PayShare(ctx context.Context, groupID, userID string) error {
	result, err := r.db.Exec(ctx,
		`UPDATE split_shares SET status = 'paid', paid_at = NOW()
		 WHERE group_id = $1 AND user_id = $2 AND status = 'pending'`,
		groupID, userID)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return fmt.Errorf("share not found or already paid")
	}
	return nil
}

func (r *Repository) DeclineShare(ctx context.Context, groupID, userID string) error {
	result, err := r.db.Exec(ctx,
		`UPDATE split_shares SET status = 'declined'
		 WHERE group_id = $1 AND user_id = $2 AND status = 'pending'`,
		groupID, userID)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return fmt.Errorf("share not found or already processed")
	}
	return nil
}

func (r *Repository) CountPendingShares(ctx context.Context, groupID string) (int, error) {
	var count int
	err := r.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM split_shares WHERE group_id = $1 AND status = 'pending'`,
		groupID).Scan(&count)
	return count, err
}
