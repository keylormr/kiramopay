package country

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

// ── Countries ────────────────────────────────────────────────────────────────

func (r *Repository) GetCountries(ctx context.Context) ([]Country, error) {
	rows, err := r.db.Query(ctx,
		`SELECT id, code, name, currency, currency_symbol, currency_name,
		 phone_prefix, flag_emoji, active, timezone, locale, created_at
		 FROM countries WHERE active = TRUE ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var countries []Country
	for rows.Next() {
		var c Country
		if err := rows.Scan(&c.ID, &c.Code, &c.Name, &c.Currency, &c.CurrencySymbol,
			&c.CurrencyName, &c.PhonePrefix, &c.FlagEmoji, &c.Active,
			&c.Timezone, &c.Locale, &c.CreatedAt); err != nil {
			return nil, err
		}
		countries = append(countries, c)
	}
	return countries, nil
}

func (r *Repository) GetCountryByCode(ctx context.Context, code string) (*Country, error) {
	var c Country
	err := r.db.QueryRow(ctx,
		`SELECT id, code, name, currency, currency_symbol, currency_name,
		 phone_prefix, flag_emoji, active, timezone, locale, created_at
		 FROM countries WHERE code = $1`, code).Scan(
		&c.ID, &c.Code, &c.Name, &c.Currency, &c.CurrencySymbol, &c.CurrencyName,
		&c.PhonePrefix, &c.FlagEmoji, &c.Active, &c.Timezone, &c.Locale, &c.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &c, nil
}

// ── Exchange Rates ───────────────────────────────────────────────────────────

func (r *Repository) GetExchangeRate(ctx context.Context, from, to string) (*ExchangeRate, error) {
	var rate ExchangeRate
	err := r.db.QueryRow(ctx,
		`SELECT id, from_currency, to_currency, rate, source, updated_at
		 FROM exchange_rates WHERE from_currency = $1 AND to_currency = $2`,
		from, to).Scan(&rate.ID, &rate.FromCurrency, &rate.ToCurrency,
		&rate.Rate, &rate.Source, &rate.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &rate, nil
}

func (r *Repository) GetAllRates(ctx context.Context) ([]ExchangeRate, error) {
	rows, err := r.db.Query(ctx,
		`SELECT id, from_currency, to_currency, rate, source, updated_at
		 FROM exchange_rates ORDER BY from_currency, to_currency`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var rates []ExchangeRate
	for rows.Next() {
		var rate ExchangeRate
		if err := rows.Scan(&rate.ID, &rate.FromCurrency, &rate.ToCurrency,
			&rate.Rate, &rate.Source, &rate.UpdatedAt); err != nil {
			return nil, err
		}
		rates = append(rates, rate)
	}
	return rates, nil
}

func (r *Repository) UpdateExchangeRate(ctx context.Context, from, to string, rate float64, source string) error {
	_, err := r.db.Exec(ctx,
		`INSERT INTO exchange_rates (from_currency, to_currency, rate, source, updated_at)
		 VALUES ($1, $2, $3, $4, NOW())
		 ON CONFLICT (from_currency, to_currency)
		 DO UPDATE SET rate = $3, source = $4, updated_at = NOW()`,
		from, to, rate, source)
	return err
}

// ── Regional Wallets ─────────────────────────────────────────────────────────

func (r *Repository) GetUserWallets(ctx context.Context, userID string) ([]RegionalWallet, error) {
	rows, err := r.db.Query(ctx,
		`SELECT id, user_id, country_code, currency, balance, active, created_at, updated_at
		 FROM regional_wallets WHERE user_id = $1 AND active = TRUE ORDER BY country_code`,
		userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var wallets []RegionalWallet
	for rows.Next() {
		var w RegionalWallet
		if err := rows.Scan(&w.ID, &w.UserID, &w.CountryCode, &w.Currency,
			&w.Balance, &w.Active, &w.CreatedAt, &w.UpdatedAt); err != nil {
			return nil, err
		}
		wallets = append(wallets, w)
	}
	return wallets, nil
}

func (r *Repository) GetOrCreateWallet(ctx context.Context, userID, countryCode, currency string) (*RegionalWallet, error) {
	var w RegionalWallet
	err := r.db.QueryRow(ctx,
		`INSERT INTO regional_wallets (user_id, country_code, currency)
		 VALUES ($1, $2, $3)
		 ON CONFLICT (user_id, country_code) DO UPDATE SET updated_at = NOW()
		 RETURNING id, user_id, country_code, currency, balance, active, created_at, updated_at`,
		userID, countryCode, currency).Scan(
		&w.ID, &w.UserID, &w.CountryCode, &w.Currency, &w.Balance, &w.Active,
		&w.CreatedAt, &w.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &w, nil
}

func (r *Repository) UpdateWalletBalance(ctx context.Context, walletID string, amount int64) error {
	result, err := r.db.Exec(ctx,
		`UPDATE regional_wallets SET balance = balance + $2, updated_at = NOW()
		 WHERE id = $1 AND balance + $2 >= 0`, walletID, amount)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return fmt.Errorf("insufficient balance or wallet not found")
	}
	return nil
}

// ── Cross-Border Transfers ───────────────────────────────────────────────────

func (r *Repository) CreateTransfer(ctx context.Context, t *CrossBorderTransfer) error {
	_, err := r.db.Exec(ctx,
		`INSERT INTO cross_border_transfers (id, sender_id, receiver_id, receiver_phone,
		 from_country, to_country, from_currency, to_currency,
		 from_amount, to_amount, exchange_rate, fee, status, compliance_status)
		 VALUES ($1, $2, NULLIF($3, ''), $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
		t.ID, t.SenderID, t.ReceiverID, t.ReceiverPhone,
		t.FromCountry, t.ToCountry, t.FromCurrency, t.ToCurrency,
		t.FromAmount, t.ToAmount, t.ExchangeRate, t.Fee, t.Status, t.ComplianceStatus)
	return err
}

func (r *Repository) GetTransfer(ctx context.Context, transferID string) (*CrossBorderTransfer, error) {
	var t CrossBorderTransfer
	err := r.db.QueryRow(ctx,
		`SELECT id, sender_id, COALESCE(receiver_id::text, ''), receiver_phone,
		 from_country, to_country, from_currency, to_currency,
		 from_amount, to_amount, exchange_rate, fee, status, compliance_status,
		 created_at, completed_at
		 FROM cross_border_transfers WHERE id = $1`, transferID).Scan(
		&t.ID, &t.SenderID, &t.ReceiverID, &t.ReceiverPhone,
		&t.FromCountry, &t.ToCountry, &t.FromCurrency, &t.ToCurrency,
		&t.FromAmount, &t.ToAmount, &t.ExchangeRate, &t.Fee,
		&t.Status, &t.ComplianceStatus, &t.CreatedAt, &t.CompletedAt)
	if err != nil {
		return nil, err
	}
	return &t, nil
}

func (r *Repository) ListUserTransfers(ctx context.Context, userID string, limit int) ([]CrossBorderTransfer, error) {
	rows, err := r.db.Query(ctx,
		`SELECT id, sender_id, COALESCE(receiver_id::text, ''), receiver_phone,
		 from_country, to_country, from_currency, to_currency,
		 from_amount, to_amount, exchange_rate, fee, status, compliance_status,
		 created_at, completed_at
		 FROM cross_border_transfers
		 WHERE sender_id = $1 OR receiver_id = $1
		 ORDER BY created_at DESC LIMIT $2`, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var transfers []CrossBorderTransfer
	for rows.Next() {
		var t CrossBorderTransfer
		if err := rows.Scan(&t.ID, &t.SenderID, &t.ReceiverID, &t.ReceiverPhone,
			&t.FromCountry, &t.ToCountry, &t.FromCurrency, &t.ToCurrency,
			&t.FromAmount, &t.ToAmount, &t.ExchangeRate, &t.Fee,
			&t.Status, &t.ComplianceStatus, &t.CreatedAt, &t.CompletedAt); err != nil {
			return nil, err
		}
		transfers = append(transfers, t)
	}
	return transfers, nil
}

func (r *Repository) UpdateTransferStatus(ctx context.Context, transferID, status string) error {
	query := `UPDATE cross_border_transfers SET status = $2 WHERE id = $1`
	if status == "completed" || status == "failed" {
		query = `UPDATE cross_border_transfers SET status = $2, completed_at = NOW() WHERE id = $1`
	}
	_, err := r.db.Exec(ctx, query, transferID, status)
	return err
}

// ── Seeding ──────────────────────────────────────────────────────────────────

func (r *Repository) SeedCountries(ctx context.Context) error {
	countries := []struct {
		Code, Name, Currency, Symbol, CurrencyName, Prefix, Flag, TZ, Locale string
	}{
		{"CR", "Costa Rica", "CRC", "₡", "Colón costarricense", "+506", "🇨🇷", "America/Costa_Rica", "es-CR"},
		{"PA", "Panamá", "PAB", "B/.", "Balboa panameño", "+507", "🇵🇦", "America/Panama", "es-PA"},
		{"GT", "Guatemala", "GTQ", "Q", "Quetzal guatemalteco", "+502", "🇬🇹", "America/Guatemala", "es-GT"},
	}

	for _, c := range countries {
		_, err := r.db.Exec(ctx,
			`INSERT INTO countries (code, name, currency, currency_symbol, currency_name,
			 phone_prefix, flag_emoji, timezone, locale)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
			 ON CONFLICT (code) DO NOTHING`,
			c.Code, c.Name, c.Currency, c.Symbol, c.CurrencyName,
			c.Prefix, c.Flag, c.TZ, c.Locale)
		if err != nil {
			return err
		}
	}

	// Seed initial exchange rates (approximate, updated at runtime)
	rates := []struct {
		From, To string
		Rate     float64
	}{
		{"CRC", "USD", 0.00194},  // 1 CRC ≈ 0.00194 USD
		{"USD", "CRC", 515.0},    // 1 USD ≈ 515 CRC
		{"CRC", "PAB", 0.00194},  // PAB is pegged to USD
		{"PAB", "CRC", 515.0},
		{"CRC", "GTQ", 0.0150},   // 1 CRC ≈ 0.015 GTQ
		{"GTQ", "CRC", 66.67},
		{"USD", "PAB", 1.0},      // PAB pegged 1:1 to USD
		{"PAB", "USD", 1.0},
		{"USD", "GTQ", 7.75},     // approximate
		{"GTQ", "USD", 0.129},
		{"PAB", "GTQ", 7.75},
		{"GTQ", "PAB", 0.129},
	}

	for _, rate := range rates {
		_, err := r.db.Exec(ctx,
			`INSERT INTO exchange_rates (from_currency, to_currency, rate, source)
			 VALUES ($1, $2, $3, 'manual')
			 ON CONFLICT (from_currency, to_currency) DO NOTHING`,
			rate.From, rate.To, rate.Rate)
		if err != nil {
			return err
		}
	}

	return nil
}
