package crypto

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

// Assets

func (r *Repository) GetAssets(ctx context.Context, userID string) ([]AssetRecord, error) {
	rows, err := r.db.Query(ctx,
		`SELECT id, user_id, symbol, name, balance, avg_cost, created_at, updated_at
		 FROM crypto_assets WHERE user_id = $1 ORDER BY balance * avg_cost DESC`,
		userID,
	)
	if err != nil {
		return nil, fmt.Errorf("query assets: %w", err)
	}
	defer rows.Close()

	var assets []AssetRecord
	for rows.Next() {
		var a AssetRecord
		if err := rows.Scan(&a.ID, &a.UserID, &a.Symbol, &a.Name, &a.Balance, &a.AvgCost, &a.CreatedAt, &a.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan asset: %w", err)
		}
		assets = append(assets, a)
	}
	if assets == nil {
		assets = []AssetRecord{}
	}
	return assets, nil
}

func (r *Repository) GetAsset(ctx context.Context, userID, symbol string) (*AssetRecord, error) {
	a := &AssetRecord{}
	err := r.db.QueryRow(ctx,
		`SELECT id, user_id, symbol, name, balance, avg_cost, created_at, updated_at
		 FROM crypto_assets WHERE user_id = $1 AND symbol = $2`,
		userID, symbol,
	).Scan(&a.ID, &a.UserID, &a.Symbol, &a.Name, &a.Balance, &a.AvgCost, &a.CreatedAt, &a.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return a, nil
}

func (r *Repository) UpsertAsset(ctx context.Context, userID, symbol, name string, balanceDelta, price float64) error {
	_, err := r.db.Exec(ctx,
		`INSERT INTO crypto_assets (id, user_id, symbol, name, balance, avg_cost, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
		 ON CONFLICT (user_id, symbol) DO UPDATE SET
		   balance = crypto_assets.balance + $5,
		   avg_cost = CASE WHEN $5 > 0 THEN
		     (crypto_assets.balance * crypto_assets.avg_cost + $5 * $6) / (crypto_assets.balance + $5)
		   ELSE crypto_assets.avg_cost END,
		   updated_at = NOW()`,
		uuid.New().String(), userID, symbol, name, balanceDelta, price,
	)
	return err
}

// Transactions

func (r *Repository) AddTransaction(ctx context.Context, tx *TransactionRecord) error {
	if tx.ID == "" {
		tx.ID = uuid.New().String()
	}
	if tx.CreatedAt.IsZero() {
		tx.CreatedAt = time.Now()
	}

	_, err := r.db.Exec(ctx,
		`INSERT INTO crypto_transactions (id, user_id, type, asset, amount, price, total, currency, fee, status, created_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
		tx.ID, tx.UserID, tx.Type, tx.Asset, tx.Amount, tx.Price, tx.Total, tx.Currency, tx.Fee, tx.Status, tx.CreatedAt,
	)
	return err
}

func (r *Repository) GetTransactions(ctx context.Context, userID string, limit int) ([]TransactionRecord, error) {
	if limit <= 0 {
		limit = 50
	}

	rows, err := r.db.Query(ctx,
		`SELECT id, user_id, type, asset, amount, price, total, currency, fee, status, created_at
		 FROM crypto_transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
		userID, limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var txs []TransactionRecord
	for rows.Next() {
		var tx TransactionRecord
		if err := rows.Scan(&tx.ID, &tx.UserID, &tx.Type, &tx.Asset, &tx.Amount, &tx.Price, &tx.Total, &tx.Currency, &tx.Fee, &tx.Status, &tx.CreatedAt); err != nil {
			return nil, err
		}
		txs = append(txs, tx)
	}
	if txs == nil {
		txs = []TransactionRecord{}
	}
	return txs, nil
}

// Staking

func (r *Repository) GetStakingPositions(ctx context.Context, userID string) ([]StakingRecord, error) {
	rows, err := r.db.Query(ctx,
		`SELECT id, user_id, asset, amount, apy, start_date, locked, lock_days, earned, status, created_at
		 FROM crypto_staking WHERE user_id = $1 AND status = 'active' ORDER BY created_at DESC`,
		userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var positions []StakingRecord
	for rows.Next() {
		var s StakingRecord
		if err := rows.Scan(&s.ID, &s.UserID, &s.Asset, &s.Amount, &s.APY, &s.StartDate, &s.Locked, &s.LockDays, &s.Earned, &s.Status, &s.CreatedAt); err != nil {
			return nil, err
		}
		positions = append(positions, s)
	}
	if positions == nil {
		positions = []StakingRecord{}
	}
	return positions, nil
}

func (r *Repository) AddStaking(ctx context.Context, s *StakingRecord) error {
	if s.ID == "" {
		s.ID = uuid.New().String()
	}

	_, err := r.db.Exec(ctx,
		`INSERT INTO crypto_staking (id, user_id, asset, amount, apy, start_date, locked, lock_days, earned, status, created_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
		s.ID, s.UserID, s.Asset, s.Amount, s.APY, s.StartDate, s.Locked, s.LockDays, s.Earned, s.Status,
	)
	return err
}

func (r *Repository) UpdateStakingStatus(ctx context.Context, id, status string) error {
	_, err := r.db.Exec(ctx, `UPDATE crypto_staking SET status = $2 WHERE id = $1`, id, status)
	return err
}

// Price Alerts

func (r *Repository) GetPriceAlerts(ctx context.Context, userID string) ([]PriceAlertRecord, error) {
	rows, err := r.db.Query(ctx,
		`SELECT id, user_id, asset, target_price, direction, active, created_at
		 FROM crypto_price_alerts WHERE user_id = $1 AND active = true ORDER BY created_at DESC`,
		userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var alerts []PriceAlertRecord
	for rows.Next() {
		var a PriceAlertRecord
		if err := rows.Scan(&a.ID, &a.UserID, &a.Asset, &a.TargetPrice, &a.Direction, &a.Active, &a.CreatedAt); err != nil {
			return nil, err
		}
		alerts = append(alerts, a)
	}
	if alerts == nil {
		alerts = []PriceAlertRecord{}
	}
	return alerts, nil
}

func (r *Repository) AddPriceAlert(ctx context.Context, a *PriceAlertRecord) error {
	if a.ID == "" {
		a.ID = uuid.New().String()
	}

	_, err := r.db.Exec(ctx,
		`INSERT INTO crypto_price_alerts (id, user_id, asset, target_price, direction, active, created_at)
		 VALUES ($1, $2, $3, $4, $5, true, NOW())`,
		a.ID, a.UserID, a.Asset, a.TargetPrice, a.Direction,
	)
	return err
}

func (r *Repository) DeactivatePriceAlert(ctx context.Context, id string) error {
	_, err := r.db.Exec(ctx, `UPDATE crypto_price_alerts SET active = false WHERE id = $1`, id)
	return err
}
