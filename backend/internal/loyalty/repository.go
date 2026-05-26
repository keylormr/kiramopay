package loyalty

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

// ── Points Account ───────────────────────────────────────────────────────────

func (r *Repository) GetOrCreateAccount(ctx context.Context, userID string) (*PointsAccount, error) {
	var acct PointsAccount
	err := r.db.QueryRow(ctx,
		`INSERT INTO loyalty_accounts (user_id) VALUES ($1)
		 ON CONFLICT (user_id) DO UPDATE SET updated_at = NOW()
		 RETURNING id, user_id, total_points, available_points, lifetime_points, tier, updated_at`,
		userID).Scan(&acct.ID, &acct.UserID, &acct.TotalPoints, &acct.AvailablePoints,
		&acct.LifetimePoints, &acct.Tier, &acct.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &acct, nil
}

func (r *Repository) UpdatePoints(ctx context.Context, userID string, earned int64) error {
	result, err := r.db.Exec(ctx,
		`UPDATE loyalty_accounts SET
		 total_points = total_points + $2,
		 available_points = available_points + $2,
		 lifetime_points = lifetime_points + GREATEST($2, 0),
		 updated_at = NOW()
		 WHERE user_id = $1`, userID, earned)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return fmt.Errorf("loyalty account not found")
	}
	return nil
}

func (r *Repository) DeductPoints(ctx context.Context, userID string, points int64) error {
	result, err := r.db.Exec(ctx,
		`UPDATE loyalty_accounts SET
		 available_points = available_points - $2,
		 updated_at = NOW()
		 WHERE user_id = $1 AND available_points >= $2`, userID, points)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return fmt.Errorf("insufficient points or account not found")
	}
	return nil
}

func (r *Repository) UpdateTier(ctx context.Context, userID, tier string) error {
	_, err := r.db.Exec(ctx,
		`UPDATE loyalty_accounts SET tier = $2, updated_at = NOW() WHERE user_id = $1`,
		userID, tier)
	return err
}

// ── Points Transactions ──────────────────────────────────────────────────────

func (r *Repository) RecordTransaction(ctx context.Context, tx *PointsTransaction) error {
	_, err := r.db.Exec(ctx,
		`INSERT INTO loyalty_transactions (id, user_id, type, points, description, ref_type, ref_id)
		 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		tx.ID, tx.UserID, tx.Type, tx.Points, tx.Description, tx.RefType, tx.RefID)
	return err
}

func (r *Repository) GetTransactions(ctx context.Context, userID string, limit int) ([]PointsTransaction, error) {
	rows, err := r.db.Query(ctx,
		`SELECT id, user_id, type, points, description, COALESCE(ref_type, ''), COALESCE(ref_id, ''), created_at
		 FROM loyalty_transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
		userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var txs []PointsTransaction
	for rows.Next() {
		var tx PointsTransaction
		if err := rows.Scan(&tx.ID, &tx.UserID, &tx.Type, &tx.Points, &tx.Description,
			&tx.RefType, &tx.RefID, &tx.CreatedAt); err != nil {
			return nil, err
		}
		txs = append(txs, tx)
	}
	return txs, nil
}

// ── Cashback Rules ───────────────────────────────────────────────────────────

func (r *Repository) GetCashbackRules(ctx context.Context) ([]CashbackRule, error) {
	rows, err := r.db.Query(ctx,
		`SELECT id, category, percentage, max_points_per_tx, active
		 FROM cashback_rules WHERE active = TRUE`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var rules []CashbackRule
	for rows.Next() {
		var rule CashbackRule
		if err := rows.Scan(&rule.ID, &rule.Category, &rule.Percentage, &rule.MaxPoints, &rule.Active); err != nil {
			return nil, err
		}
		rules = append(rules, rule)
	}
	return rules, nil
}

// ── Rewards Catalog ──────────────────────────────────────────────────────────

func (r *Repository) GetAvailableRewards(ctx context.Context) ([]Reward, error) {
	rows, err := r.db.Query(ctx,
		`SELECT id, name, description, category, points_cost, image_url,
		 COALESCE(partner_code, ''), active, stock, expires_at, created_at
		 FROM loyalty_rewards
		 WHERE active = TRUE AND (stock = -1 OR stock > 0)
		   AND (expires_at IS NULL OR expires_at > NOW())
		 ORDER BY points_cost ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var rewards []Reward
	for rows.Next() {
		var rw Reward
		if err := rows.Scan(&rw.ID, &rw.Name, &rw.Description, &rw.Category, &rw.PointsCost,
			&rw.ImageURL, &rw.PartnerCode, &rw.Active, &rw.Stock, &rw.ExpiresAt, &rw.CreatedAt); err != nil {
			return nil, err
		}
		rewards = append(rewards, rw)
	}
	return rewards, nil
}

func (r *Repository) GetReward(ctx context.Context, rewardID string) (*Reward, error) {
	var rw Reward
	err := r.db.QueryRow(ctx,
		`SELECT id, name, description, category, points_cost, image_url,
		 COALESCE(partner_code, ''), active, stock, expires_at, created_at
		 FROM loyalty_rewards WHERE id = $1`, rewardID).Scan(
		&rw.ID, &rw.Name, &rw.Description, &rw.Category, &rw.PointsCost,
		&rw.ImageURL, &rw.PartnerCode, &rw.Active, &rw.Stock, &rw.ExpiresAt, &rw.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &rw, nil
}

func (r *Repository) DecrementRewardStock(ctx context.Context, rewardID string) error {
	_, err := r.db.Exec(ctx,
		`UPDATE loyalty_rewards SET stock = stock - 1 WHERE id = $1 AND stock > 0`, rewardID)
	return err
}

// ── Redemptions ──────────────────────────────────────────────────────────────

func (r *Repository) CreateRedemption(ctx context.Context, rd *Redemption) error {
	_, err := r.db.Exec(ctx,
		`INSERT INTO loyalty_redemptions (id, user_id, reward_id, points, status, code)
		 VALUES ($1, $2, $3, $4, $5, $6)`,
		rd.ID, rd.UserID, rd.RewardID, rd.Points, rd.Status, rd.Code)
	return err
}

func (r *Repository) GetUserRedemptions(ctx context.Context, userID string) ([]Redemption, error) {
	rows, err := r.db.Query(ctx,
		`SELECT id, user_id, reward_id, points, status, COALESCE(code, ''), created_at
		 FROM loyalty_redemptions WHERE user_id = $1 ORDER BY created_at DESC`,
		userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var rds []Redemption
	for rows.Next() {
		var rd Redemption
		if err := rows.Scan(&rd.ID, &rd.UserID, &rd.RewardID, &rd.Points, &rd.Status,
			&rd.Code, &rd.CreatedAt); err != nil {
			return nil, err
		}
		rds = append(rds, rd)
	}
	return rds, nil
}

// ── Seeding ──────────────────────────────────────────────────────────────────

func (r *Repository) SeedCashbackRules(ctx context.Context) error {
	rules := []struct {
		Category   string
		Percentage float64
		MaxPoints  int64
	}{
		{"transaction", 1.0, 500},   // 1% on regular transactions, max 500 pts
		{"sinpe", 0.5, 250},         // 0.5% on SINPE, max 250 pts
		{"service", 2.0, 1000},      // 2% on bill payments, max 1000 pts
		{"marketplace", 3.0, 1500},  // 3% on marketplace, max 1500 pts
		{"crypto", 0.25, 100},       // 0.25% on crypto, max 100 pts
	}

	for _, rule := range rules {
		_, err := r.db.Exec(ctx,
			`INSERT INTO cashback_rules (category, percentage, max_points_per_tx)
			 VALUES ($1, $2, $3) ON CONFLICT (category) DO NOTHING`,
			rule.Category, rule.Percentage, rule.MaxPoints)
		if err != nil {
			return err
		}
	}
	return nil
}

func (r *Repository) SeedRewards(ctx context.Context) error {
	rewards := []struct {
		Name, Description, Category, ImageURL, PartnerCode string
		PointsCost                                          int64
		Stock                                               int
	}{
		{"₡500 descuento Uber", "Cupón de descuento para tu próximo viaje", "discount", "uber_discount.png", "uber", 1000, -1},
		{"₡1000 descuento Uber Eats", "Descuento en pedidos de comida", "voucher", "ubereats_voucher.png", "ubereats", 2000, -1},
		{"Cinemark 2x1", "Entradas al cine 2 por 1", "experience", "cinemark_2x1.png", "cinemark", 3000, 100},
		{"₡5000 en Auto Mercado", "Gift card digital para Auto Mercado", "gift_card", "automercado_gc.png", "automercado", 10000, 50},
		{"₡2500 recarga Kolbi", "Recarga telefónica gratis", "voucher", "kolbi_recharge.png", "", 5000, -1},
		{"Cash back ₡10,000", "Crédito directo a tu wallet", "discount", "cashback_10k.png", "", 20000, -1},
	}

	for _, rw := range rewards {
		_, err := r.db.Exec(ctx,
			`INSERT INTO loyalty_rewards (name, description, category, points_cost, image_url, partner_code, stock)
			 VALUES ($1, $2, $3, $4, $5, NULLIF($6, ''), $7)
			 ON CONFLICT DO NOTHING`,
			rw.Name, rw.Description, rw.Category, rw.PointsCost, rw.ImageURL, rw.PartnerCode, rw.Stock)
		if err != nil {
			return err
		}
	}
	return nil
}
