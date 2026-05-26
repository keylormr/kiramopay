package cards

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

// ── Cards ────────────────────────────────────────────────────────────────────

func (r *Repository) CreateCard(ctx context.Context, card *VirtualCard) error {
	_, err := r.db.Exec(ctx,
		`INSERT INTO virtual_cards (id, user_id, card_number, last4, expiry_month, expiry_year,
		 cardholder_name, brand, type, currency, status, daily_limit, monthly_limit, atm_limit)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
		card.ID, card.UserID, card.CardNumber, card.Last4, card.ExpiryMonth, card.ExpiryYear,
		card.CardholderName, card.Brand, card.Type, card.Currency, card.Status,
		card.DailyLimit, card.MonthlyLimit, card.AtmLimit)
	return err
}

func (r *Repository) GetCard(ctx context.Context, cardID string) (*VirtualCard, error) {
	var card VirtualCard
	err := r.db.QueryRow(ctx,
		`SELECT id, user_id, card_number, last4, expiry_month, expiry_year,
		 cardholder_name, brand, type, currency, status,
		 daily_limit, monthly_limit, atm_limit, daily_spent, monthly_spent,
		 COALESCE(provider_card_id, ''), created_at, frozen_at
		 FROM virtual_cards WHERE id = $1`, cardID).Scan(
		&card.ID, &card.UserID, &card.CardNumber, &card.Last4, &card.ExpiryMonth, &card.ExpiryYear,
		&card.CardholderName, &card.Brand, &card.Type, &card.Currency, &card.Status,
		&card.DailyLimit, &card.MonthlyLimit, &card.AtmLimit, &card.DailySpent, &card.MonthlySpent,
		&card.ProviderCardID, &card.CreatedAt, &card.FrozenAt)
	if err != nil {
		return nil, err
	}
	return &card, nil
}

func (r *Repository) GetUserCards(ctx context.Context, userID string) ([]VirtualCard, error) {
	rows, err := r.db.Query(ctx,
		`SELECT id, user_id, card_number, last4, expiry_month, expiry_year,
		 cardholder_name, brand, type, currency, status,
		 daily_limit, monthly_limit, atm_limit, daily_spent, monthly_spent,
		 COALESCE(provider_card_id, ''), created_at, frozen_at
		 FROM virtual_cards WHERE user_id = $1 AND status != 'cancelled'
		 ORDER BY created_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var cardList []VirtualCard
	for rows.Next() {
		var card VirtualCard
		if err := rows.Scan(
			&card.ID, &card.UserID, &card.CardNumber, &card.Last4, &card.ExpiryMonth, &card.ExpiryYear,
			&card.CardholderName, &card.Brand, &card.Type, &card.Currency, &card.Status,
			&card.DailyLimit, &card.MonthlyLimit, &card.AtmLimit, &card.DailySpent, &card.MonthlySpent,
			&card.ProviderCardID, &card.CreatedAt, &card.FrozenAt); err != nil {
			return nil, err
		}
		cardList = append(cardList, card)
	}
	return cardList, nil
}

func (r *Repository) CountUserCards(ctx context.Context, userID string) (int, error) {
	var count int
	err := r.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM virtual_cards WHERE user_id = $1 AND status != 'cancelled'`,
		userID).Scan(&count)
	return count, err
}

func (r *Repository) UpdateCardStatus(ctx context.Context, cardID, status string) error {
	var query string
	switch status {
	case "frozen":
		query = `UPDATE virtual_cards SET status = 'frozen', frozen_at = NOW() WHERE id = $1`
	case "active":
		query = `UPDATE virtual_cards SET status = 'active', frozen_at = NULL WHERE id = $1`
	default:
		query = `UPDATE virtual_cards SET status = $2 WHERE id = $1`
	}

	var result interface{ RowsAffected() int64 }
	var err error
	if status == "frozen" || status == "active" {
		r, e := r.db.Exec(ctx, query, cardID)
		result = r
		err = e
	} else {
		r, e := r.db.Exec(ctx, query, cardID, status)
		result = r
		err = e
	}
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return fmt.Errorf("card not found")
	}
	return nil
}

func (r *Repository) UpdateLimits(ctx context.Context, cardID string, daily, monthly, atm *int64) error {
	updates := ""
	args := []interface{}{cardID}
	argIdx := 2

	if daily != nil {
		updates += fmt.Sprintf("daily_limit = $%d, ", argIdx)
		args = append(args, *daily)
		argIdx++
	}
	if monthly != nil {
		updates += fmt.Sprintf("monthly_limit = $%d, ", argIdx)
		args = append(args, *monthly)
		argIdx++
	}
	if atm != nil {
		updates += fmt.Sprintf("atm_limit = $%d, ", argIdx)
		args = append(args, *atm)
		argIdx++
	}

	if updates == "" {
		return nil
	}

	// Remove trailing comma and space
	updates = updates[:len(updates)-2]

	query := fmt.Sprintf("UPDATE virtual_cards SET %s WHERE id = $1", updates)
	_, err := r.db.Exec(ctx, query, args...)
	return err
}

// ── Card Transactions ────────────────────────────────────────────────────────

func (r *Repository) RecordCardTransaction(ctx context.Context, tx *CardTransaction) error {
	_, err := r.db.Exec(ctx,
		`INSERT INTO card_transactions (id, card_id, user_id, amount, currency, merchant_name, category, status, decline_reason)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
		tx.ID, tx.CardID, tx.UserID, tx.Amount, tx.Currency, tx.MerchantName,
		tx.Category, tx.Status, tx.DeclineReason)
	return err
}

func (r *Repository) GetCardTransactions(ctx context.Context, cardID string, limit int) ([]CardTransaction, error) {
	rows, err := r.db.Query(ctx,
		`SELECT id, card_id, user_id, amount, currency, merchant_name, category, status,
		 COALESCE(decline_reason, ''), created_at
		 FROM card_transactions WHERE card_id = $1 ORDER BY created_at DESC LIMIT $2`,
		cardID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var txs []CardTransaction
	for rows.Next() {
		var tx CardTransaction
		if err := rows.Scan(&tx.ID, &tx.CardID, &tx.UserID, &tx.Amount, &tx.Currency,
			&tx.MerchantName, &tx.Category, &tx.Status, &tx.DeclineReason, &tx.CreatedAt); err != nil {
			return nil, err
		}
		txs = append(txs, tx)
	}
	return txs, nil
}

func (r *Repository) UpdateDailySpent(ctx context.Context, cardID string, amount int64) error {
	_, err := r.db.Exec(ctx,
		`UPDATE virtual_cards SET daily_spent = daily_spent + $2, monthly_spent = monthly_spent + $2
		 WHERE id = $1`, cardID, amount)
	return err
}
