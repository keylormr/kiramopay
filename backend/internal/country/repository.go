package country

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
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
	// After migration 021 the table is historized; the *active* rate for a pair
	// is the open-ended row (effective_to IS NULL). Without this filter a closed
	// historical row could be returned once rates start being updated.
	err := r.db.QueryRow(ctx,
		`SELECT id, from_currency, to_currency, rate, source, updated_at
		 FROM exchange_rates
		 WHERE from_currency = $1 AND to_currency = $2 AND effective_to IS NULL
		 ORDER BY effective_from DESC
		 LIMIT 1`,
		from, to).Scan(&rate.ID, &rate.FromCurrency, &rate.ToCurrency,
		&rate.Rate, &rate.Source, &rate.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &rate, nil
}

func (r *Repository) GetAllRates(ctx context.Context) ([]ExchangeRate, error) {
	// Only the active row per pair (effective_to IS NULL); historized rows are
	// forensic history, not something the public endpoint should surface.
	rows, err := r.db.Query(ctx,
		`SELECT id, from_currency, to_currency, rate, source, updated_at
		 FROM exchange_rates
		 WHERE effective_to IS NULL
		 ORDER BY from_currency, to_currency`)
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

// UpdateExchangeRate queda por compatibilidad; ver RegistrarTipoDeCambio.
func (r *Repository) UpdateExchangeRate(ctx context.Context, from, to string, rate float64, source string) error {
	return r.RegistrarTipoDeCambio(ctx, from, to, rate, source)
}

// RegistrarTipoDeCambio deja `rate` como el tipo de cambio vigente del par.
//
// La version anterior hacia `ON CONFLICT (from_currency, to_currency)`, y esa
// restriccion NO EXISTE desde la migracion 021, que paso la tabla a historial:
// el unico indice unico es parcial (solo la fila vigente, effective_to IS
// NULL) y un ON CONFLICT sin su predicado no lo encuentra. La funcion habria
// fallado con 42P10 en la primera llamada — nunca se noto porque nadie la
// llamaba.
//
// Ahora respeta el historial:
//   - si la tasa CAMBIO, inserta una fila nueva y el disparador
//     trg_fx_close_active cierra la anterior, que queda como historia;
//   - si NO cambio, solo sella updated_at en la fila vigente. updated_at pasa a
//     significar "ultima vez que la fuente lo confirmo", que es lo que mide la
//     antiguedad. Sin esto, un fin de semana sin movimiento del dolar dejaria
//     el tipo de cambio "viejo" aunque la fuente lo haya confirmado cada hora.
//
// Todo en una transaccion con la fila vigente bloqueada: dos actualizadores a
// la vez no pueden insertar dos filas vigentes.
func (r *Repository) RegistrarTipoDeCambio(ctx context.Context, from, to string, rate float64, source string) error {
	if rate <= 0 {
		return fmt.Errorf("tipo de cambio %s/%s no positivo: %v", from, to, rate)
	}
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var id string
	var vigente float64
	err = tx.QueryRow(ctx,
		`SELECT id::text, rate FROM exchange_rates
		  WHERE from_currency = $1 AND to_currency = $2 AND effective_to IS NULL
		  FOR UPDATE`, from, to).Scan(&id, &vigente)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		// Primera vez para este par: no hay nada que cerrar.
	case err != nil:
		return err
	case !cambioSignificativo(vigente, rate):
		if _, err := tx.Exec(ctx,
			`UPDATE exchange_rates SET updated_at = NOW(), source = $2 WHERE id = $1::uuid`,
			id, source); err != nil {
			return err
		}
		return tx.Commit(ctx)
	}

	if _, err := tx.Exec(ctx,
		`INSERT INTO exchange_rates (from_currency, to_currency, rate, source_rate, source, updated_at)
		 VALUES ($1, $2, $3, $3, $4, NOW())`,
		from, to, rate, source); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// TipoDeCambioConEdad devuelve la tasa vigente del par y cuanto hace que la
// fuente la confirmo.
//
// La edad se calcula EN LA BASE: updated_at es TIMESTAMP sin zona, y restarlo
// contra el reloj del proceso mezclaria dos zonas horarias. Contra NOW() de la
// misma sesion las dos puntas usan la misma.
func (r *Repository) TipoDeCambioConEdad(ctx context.Context, from, to string) (float64, time.Duration, error) {
	var tasa float64
	var segundos float64
	err := r.db.QueryRow(ctx,
		`SELECT rate, EXTRACT(EPOCH FROM (NOW()::timestamp - updated_at))
		   FROM exchange_rates
		  WHERE from_currency = $1 AND to_currency = $2 AND effective_to IS NULL
		  ORDER BY effective_from DESC
		  LIMIT 1`, from, to).Scan(&tasa, &segundos)
	if err != nil {
		return 0, 0, err
	}
	return tasa, time.Duration(segundos * float64(time.Second)), nil
}

// TipoDeCambioParaCobrar es la version del camino que mueve dinero: se niega a
// devolver una tasa que la fuente no confirmo dentro de EdadMaximaTipoDeCambio.
// Mejor no operar que operar con un numero que dejo de ser cierto.
func (r *Repository) TipoDeCambioParaCobrar(ctx context.Context, from, to string) (float64, error) {
	tasa, edad, err := r.TipoDeCambioConEdad(ctx, from, to)
	if err != nil {
		return 0, err
	}
	if edad > EdadMaximaTipoDeCambio {
		return 0, fmt.Errorf("%w: %s/%s sin confirmar hace %s", ErrTipoDeCambioViejo,
			from, to, edad.Round(time.Hour))
	}
	return tasa, nil
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
		{"CRC", "USD", 0.00194}, // 1 CRC ≈ 0.00194 USD
		{"USD", "CRC", 515.0},   // 1 USD ≈ 515 CRC
		{"CRC", "PAB", 0.00194}, // PAB is pegged to USD
		{"PAB", "CRC", 515.0},
		{"CRC", "GTQ", 0.0150}, // 1 CRC ≈ 0.015 GTQ
		{"GTQ", "CRC", 66.67},
		{"USD", "PAB", 1.0}, // PAB pegged 1:1 to USD
		{"PAB", "USD", 1.0},
		{"USD", "GTQ", 7.75}, // approximate
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
