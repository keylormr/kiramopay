package database

import (
	"context"
	"fmt"
	"log"
	"os"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/kiramopay/backend/pkg/hash"
)

type TestUser struct {
	ID         string
	Cedula     string
	Phone      string
	FirstName  string
	LastName   string
	Password   string
	KYCLevel   int
	BalanceCRC int64
	BalanceUSD int64
}

var DefaultTestUsers = []TestUser{
	{
		ID:         "a0000000-0000-0000-0000-000000000001",
		Cedula:     "702650930",
		Phone:      "+50688880001",
		FirstName:  "Keilor",
		LastName:   "Martinez",
		Password:   "Kiramopay2024!",
		KYCLevel:   1,
		BalanceCRC: 125750000, // ₡1,257,500.00
		BalanceUSD: 34500,     // $345.00
	},
	{
		ID:         "a0000000-0000-0000-0000-000000000002",
		Cedula:     "700000000",
		Phone:      "+50688880002",
		FirstName:  "Admin",
		LastName:   "KiramoPay",
		Password:   "Admin2024!",
		KYCLevel:   2,
		BalanceCRC: 500000000, // ₡5,000,000.00
		BalanceUSD: 100000,    // $1,000.00
	},
	{
		// Demo account for presentations. In production its password is NOT this
		// dev-only value — it MUST be supplied via SEED_PASSWORD_701234567 (see
		// resolveSeedPassword); the real demo password is never stored in the repo.
		ID:         "a0000000-0000-0000-0000-000000000003",
		Cedula:     "701234567",
		Phone:      "+50688880003",
		FirstName:  "Demo",
		LastName:   "KiramoPay",
		Password:   "DemoLocal2026!", // local-development fallback only
		KYCLevel:   1,
		BalanceCRC: 75000000, // ₡750,000.00
		BalanceUSD: 20000,    // $200.00
	},
	{
		// Team/demo account. Same rule as above: in any non-development
		// environment the password MUST come from SEED_PASSWORD_101010101 (no
		// hardcoded fallback); the value below is only used for local dev.
		ID:         "a0000000-0000-0000-0000-000000000004",
		Cedula:     "101010101",
		Phone:      "+50688880004",
		FirstName:  "Victor",
		LastName:   "Lobo",
		Password:   "VictorLocal2026!", // local-development fallback only
		KYCLevel:   1,
		BalanceCRC: 250000000, // ₡2,500,000.00
		BalanceUSD: 50000,     // $500.00
	},
	{
		// Team/demo account. Password in non-development comes from
		// SEED_PASSWORD_202020202 (no hardcoded fallback).
		ID:         "a0000000-0000-0000-0000-000000000005",
		Cedula:     "202020202",
		Phone:      "+50688880005",
		FirstName:  "Emmanuel",
		LastName:   "Coto",
		Password:   "EmmanuelLocal2026!", // local-development fallback only
		KYCLevel:   1,
		BalanceCRC: 250000000, // ₡2,500,000.00
		BalanceUSD: 50000,     // $500.00
	},
}

// SeedDevelopment provisions the demo users. devMode is true only when the
// server runs in the `development` environment. The built-in demo passwords are
// used ONLY in development; when seeding is forced in any other environment
// (SEED_DEMO=true), each user's password MUST be supplied via
// SEED_PASSWORD_<CEDULA> with no hardcoded fallback — otherwise that user is
// skipped. This guarantees the repository never ships usable production
// credentials (the cedula 700000000 account is promoted to admin by migration
// 026, so a known password there is a full admin takeover).
func SeedDevelopment(ctx context.Context, pool *pgxpool.Pool, devMode bool) error {
	for _, u := range DefaultTestUsers {
		// Check if user already exists
		var exists bool
		err := pool.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM users WHERE cedula = $1)", u.Cedula).Scan(&exists)
		if err != nil {
			return fmt.Errorf("check user exists: %w", err)
		}
		if exists {
			log.Printf("Seed: user %s (%s) already exists, skipping", u.Cedula, u.FirstName)
			continue
		}

		password, ok := resolveSeedPassword(u, devMode)
		if !ok {
			log.Printf("Seed: skipping %s (%s) — set SEED_PASSWORD_%s to seed it outside development",
				u.Cedula, u.FirstName, u.Cedula)
			continue
		}

		// Hash password with Argon2id
		pinHash, err := hash.HashPin(password)
		if err != nil {
			return fmt.Errorf("hash password for %s: %w", u.Cedula, err)
		}

		// Insert user
		_, err = pool.Exec(ctx,
			`INSERT INTO users (id, cedula, phone, first_name, last_name, password_hash, status, kyc_level, kyc_status)
			 VALUES ($1, $2, $3, $4, $5, $6, 'active', $7, 'verified')`,
			u.ID, u.Cedula, u.Phone, u.FirstName, u.LastName, pinHash, u.KYCLevel,
		)
		if err != nil {
			return fmt.Errorf("insert user %s: %w", u.Cedula, err)
		}

		// Create wallet
		walletID := uuid.New().String()
		_, err = pool.Exec(ctx,
			`INSERT INTO wallets (id, user_id, balance_crc, balance_usd)
			 VALUES ($1, $2, $3, $4)`,
			walletID, u.ID, u.BalanceCRC, u.BalanceUSD,
		)
		if err != nil {
			return fmt.Errorf("insert wallet for %s: %w", u.Cedula, err)
		}

		// Mirror the seed balances into the journal so the reconciler stays
		// at zero drift in development. Each currency is posted as one
		// balanced journal posting (debit reserve, credit user wallet).
		// The user's ledger account was provisioned by the trigger on
		// INSERT INTO users.
		if u.BalanceCRC > 0 {
			if err := seedOpeningPosting(ctx, pool, u.ID, "CRC", u.BalanceCRC); err != nil {
				return fmt.Errorf("seed opening CRC for %s: %w", u.Cedula, err)
			}
		}
		if u.BalanceUSD > 0 {
			if err := seedOpeningPosting(ctx, pool, u.ID, "USD", u.BalanceUSD); err != nil {
				return fmt.Errorf("seed opening USD for %s: %w", u.Cedula, err)
			}
		}

		log.Printf("Seed: created user %s (%s %s) with wallet", u.Cedula, u.FirstName, u.LastName)

		// Seed rich demo data for Keilor
		if u.Cedula == "702650930" {
			seedSinpeContacts(ctx, pool, u.ID)
			seedTransactions(ctx, pool, u.ID)
			seedSavedServices(ctx, pool, u.ID)
			seedNotifications(ctx, pool, u.ID)
			seedBudgets(ctx, pool, u.ID)
			seedRecurringPayments(ctx, pool, u.ID)
			seedLoyalty(ctx, pool, u.ID)
			seedCryptoData(ctx, pool, u.ID)
		}
	}

	return nil
}

// resolveSeedPassword returns the password to seed a demo user with, and false
// to skip the user. Outside development the password must come from
// SEED_PASSWORD_<CEDULA> (no hardcoded fallback); in development the built-in
// demo password is used for local convenience.
func resolveSeedPassword(u TestUser, devMode bool) (string, bool) {
	if envPw := strings.TrimSpace(os.Getenv("SEED_PASSWORD_" + u.Cedula)); envPw != "" {
		return envPw, true
	}
	if devMode {
		return u.Password, true
	}
	return "", false
}

// seedOpeningPosting writes one balanced double-entry posting that mirrors
// the cached wallet balance. Used by the dev seeder so the reconciler does
// not flag the seed data as drift. All three inserts run in one tx so the
// DEFERRABLE balance-check trigger evaluates once at COMMIT.
func seedOpeningPosting(ctx context.Context, pool *pgxpool.Pool, userID, currency string, amountMinor int64) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	postingID := uuid.New().String()
	reserveCode := "SYSTEM:RESERVE:" + currency

	if _, err := tx.Exec(ctx,
		`INSERT INTO journal_postings (id, description, metadata, created_by)
		 VALUES ($1::uuid, $2, jsonb_build_object('source','dev_seed'), $3::uuid)`,
		postingID, "DEV_SEED_OPENING_BALANCE_"+currency, userID,
	); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO journal_entries (posting_id, account_id, direction, amount_minor, currency)
		SELECT $1::uuid, la.id, 'credit', $3::bigint, $2::varchar
		FROM ledger_accounts la
		WHERE la.user_id = $4::uuid AND la.currency = $2::varchar AND la.type = 'user_wallet'`,
		postingID, currency, amountMinor, userID,
	); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO journal_entries (posting_id, account_id, direction, amount_minor, currency)
		SELECT $1::uuid, la.id, 'debit', $3::bigint, $2::varchar
		FROM ledger_accounts la
		WHERE la.code = $4`,
		postingID, currency, amountMinor, reserveCode,
	); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func seedSinpeContacts(ctx context.Context, pool *pgxpool.Pool, userID string) {
	contacts := []struct {
		Phone, Name, Bank string
		Favorite          bool
	}{
		{"+50688881234", "Diego Mora", "BAC", true},
		{"+50677775678", "María González", "BCR", true},
		{"+50666669012", "Carlos Jiménez", "Banco Nacional", false},
		{"+50685853456", "Ana Rodríguez", "Scotiabank", false},
	}
	for _, c := range contacts {
		_, err := pool.Exec(ctx,
			`INSERT INTO sinpe_contacts (id, user_id, phone, name, bank, is_favorite)
			 VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
			uuid.New().String(), userID, c.Phone, c.Name, c.Bank, c.Favorite)
		if err != nil {
			log.Printf("Seed: sinpe contact error: %v", err)
		}
	}
	log.Printf("Seed: created SINPE contacts for user %s", userID)
}

func seedTransactions(ctx context.Context, pool *pgxpool.Pool, userID string) {
	// Resolve user's wallet so the FK is correct.
	var walletID string
	if err := pool.QueryRow(ctx,
		`SELECT id::text FROM wallets WHERE user_id = $1::uuid`, userID).Scan(&walletID); err != nil {
		log.Printf("Seed: cannot resolve wallet for transactions: %v", err)
		return
	}

	// Schema reference (migration 001 + 018):
	//   transactions(id, wallet_id, user_id, type, amount BIGINT, currency,
	//                fee, counterparty_type, counterparty_name, counterparty_phone,
	//                status, metadata jsonb, idempotency_key, created_at, created_date)
	//
	// `type` is one of: sinpe_send, sinpe_receive, qr_payment, bill_payment,
	// recharge, deposit, withdrawal, p2p_send, p2p_receive, refund.
	// `amount` is always positive minor units; direction is encoded by `type`.
	txs := []struct {
		Type, Counterparty, Phone, Description string
		Amount                                 int64
	}{
		{"qr_payment", "Café Alma", "", "Desayuno", 750000},
		{"sinpe_receive", "Diego Mora", "+50688881234", "Devolución", 2500000},
		{"qr_payment", "Uber CR", "", "Viaje al trabajo", 435000},
		{"bill_payment", "ICE", "", "Recibo eléctrico", 3245000},
		{"qr_payment", "Uber Eats", "", "Almuerzo equipo", 1280000},
		{"qr_payment", "Auto Mercado", "", "Compras de la semana", 1850000},
	}
	for i, tx := range txs {
		_, err := pool.Exec(ctx,
			`INSERT INTO transactions (id, wallet_id, user_id, type, amount, currency,
			   counterparty_type, counterparty_name, counterparty_phone,
			   status, metadata, idempotency_key, created_at)
			 VALUES ($1::uuid, $2::uuid, $3::uuid, $4::text, $5::bigint, 'CRC',
			   $6::text, NULLIF($7::text, ''), NULLIF($8::text, ''),
			   'completed', jsonb_build_object('description', $9::text, 'seed', true),
			   $10::text, NOW() - ($11::int * INTERVAL '1 day'))
			 ON CONFLICT DO NOTHING`,
			uuid.New().String(), walletID, userID, tx.Type, tx.Amount,
			counterpartyType(tx.Type), tx.Counterparty, tx.Phone,
			tx.Description, fmt.Sprintf("seed-tx-%d", i), i,
		)
		if err != nil {
			log.Printf("Seed: transaction error: %v", err)
		}
	}
	log.Printf("Seed: created %d historical transactions for user %s", len(txs), userID)
}

func counterpartyType(txType string) string {
	switch txType {
	case "sinpe_send", "sinpe_receive", "p2p_send", "p2p_receive":
		return "user"
	case "qr_payment", "qr_receive":
		return "merchant"
	case "bill_payment", "recharge":
		return "service"
	default:
		return "external"
	}
}

// seedCryptoData populates crypto holdings, transactions, staking and alerts
// so the Crypto view has real content. Prices are kept loose; the frontend's
// price service fills currentPrice live.
func seedCryptoData(ctx context.Context, pool *pgxpool.Pool, userID string) {
	assets := []struct {
		Symbol, Name string
		Balance      float64
		AvgCost      float64
	}{
		{"BTC", "Bitcoin", 0.02500000, 72500.00},
		{"ETH", "Ethereum", 0.85000000, 2150.00},
		{"SOL", "Solana", 12.40000000, 142.00},
	}
	for _, a := range assets {
		if _, err := pool.Exec(ctx,
			`INSERT INTO crypto_assets (id, user_id, symbol, name, balance, avg_cost)
			 VALUES ($1::uuid, $2::uuid, $3::text, $4::text, $5::numeric, $6::numeric)
			 ON CONFLICT (user_id, symbol) DO NOTHING`,
			uuid.New().String(), userID, a.Symbol, a.Name, a.Balance, a.AvgCost,
		); err != nil {
			log.Printf("Seed: crypto asset error (%s): %v", a.Symbol, err)
		}
	}

	cryptoTxs := []struct {
		Type, Asset string
		Amount      float64
		Price       float64
		Currency    string
	}{
		{"buy", "BTC", 0.01500000, 71200, "USD"},
		{"buy", "BTC", 0.01000000, 74500, "USD"},
		{"buy", "ETH", 0.50000000, 2080, "USD"},
		{"buy", "ETH", 0.35000000, 2250, "USD"},
		{"buy", "SOL", 12.40000000, 142.00, "USD"},
	}
	for i, t := range cryptoTxs {
		total := t.Amount * t.Price
		if _, err := pool.Exec(ctx,
			`INSERT INTO crypto_transactions
			   (id, user_id, type, asset, amount, price, total, currency, fee, status, created_at)
			 VALUES ($1::uuid, $2::uuid, $3::text, $4::text, $5::numeric, $6::numeric,
			         $7::numeric, $8::text, 0, 'completed', NOW() - ($9::int * INTERVAL '1 day'))`,
			uuid.New().String(), userID, t.Type, t.Asset, t.Amount, t.Price, total, t.Currency, i*7+2,
		); err != nil {
			log.Printf("Seed: crypto tx error: %v", err)
		}
	}

	// One active staking position (1.2 ETH @ 4.5% APY locked 30 days).
	if _, err := pool.Exec(ctx,
		`INSERT INTO crypto_staking (id, user_id, asset, amount, apy, start_date, locked, lock_days, earned, status)
		 VALUES ($1::uuid, $2::uuid, 'ETH', 0.30000000, 4.5,
		         NOW() - INTERVAL '12 days', true, 30, 0.00148356, 'active')`,
		uuid.New().String(), userID,
	); err != nil {
		log.Printf("Seed: crypto staking error: %v", err)
	}

	// One above-price alert.
	if _, err := pool.Exec(ctx,
		`INSERT INTO crypto_price_alerts (id, user_id, asset, target_price, direction, active)
		 VALUES ($1::uuid, $2::uuid, 'BTC', 85000, 'above', true)`,
		uuid.New().String(), userID,
	); err != nil {
		log.Printf("Seed: crypto alert error: %v", err)
	}

	log.Printf("Seed: created crypto data (%d assets, %d txs) for user %s",
		len(assets), len(cryptoTxs), userID)
}

func seedSavedServices(ctx context.Context, pool *pgxpool.Pool, userID string) {
	// saved_services FKs provider_id → service_providers(id), so the providers
	// must exist first. We upsert a small CR catalogue and then reference them.
	providers := []struct {
		Code, Name, Category string
	}{
		{"ice", "ICE — Electricidad", "electricity"},
		{"aya", "AyA — Agua", "water"},
		{"kolbi", "Kölbi — Telefonía", "telecom"},
		{"cabletica", "Cabletica — Internet", "internet"},
	}
	for _, p := range providers {
		if _, err := pool.Exec(ctx,
			`INSERT INTO service_providers (id, code, name, category, is_active)
			 VALUES ($1::uuid, $2::text, $3::text, $4::text, true)
			 ON CONFLICT (code) DO NOTHING`,
			uuid.New().String(), p.Code, p.Name, p.Category,
		); err != nil {
			log.Printf("Seed: service provider error (%s): %v", p.Code, err)
		}
	}

	saved := []struct {
		ProviderCode, ClientID, Nickname string
	}{
		{"ice", "1234567", "Casa"},
		{"aya", "7654321", "Apartamento"},
	}
	for _, s := range saved {
		if _, err := pool.Exec(ctx, `
			INSERT INTO saved_services (id, user_id, provider_id, client_id, nickname)
			SELECT $1::uuid, $2::uuid, sp.id, $3::text, $4::text
			FROM service_providers sp WHERE sp.code = $5::text
			ON CONFLICT DO NOTHING`,
			uuid.New().String(), userID, s.ClientID, s.Nickname, s.ProviderCode,
		); err != nil {
			log.Printf("Seed: saved service error: %v", err)
		}
	}
	log.Printf("Seed: created saved services for user %s", userID)
}

func seedNotifications(ctx context.Context, pool *pgxpool.Pool, userID string) {
	// migration 013 created notification_history (body, read_at), not notifications.
	notifs := []struct {
		Title, Body, Type string
		Read              bool
	}{
		{"Bienvenido a KiramoPay", "Tu cuenta ha sido creada exitosamente.", "info", false},
		{"SINPE recibido", "Diego Mora te envió ₡25,000 por SINPE Móvil", "transaction", false},
		{"Pago exitoso", "Tu pago de ₡32,450 a ICE fue procesado correctamente", "transaction", true},
	}
	for _, n := range notifs {
		var readAt interface{}
		if n.Read {
			readAt = "NOW()"
			_, err := pool.Exec(ctx,
				`INSERT INTO notification_history (id, user_id, title, body, type, read_at)
				 VALUES ($1::uuid, $2::uuid, $3::text, $4::text, $5::text, NOW())
				 ON CONFLICT DO NOTHING`,
				uuid.New().String(), userID, n.Title, n.Body, n.Type)
			if err != nil {
				log.Printf("Seed: notification error: %v", err)
			}
		} else {
			_, err := pool.Exec(ctx,
				`INSERT INTO notification_history (id, user_id, title, body, type)
				 VALUES ($1::uuid, $2::uuid, $3::text, $4::text, $5::text)
				 ON CONFLICT DO NOTHING`,
				uuid.New().String(), userID, n.Title, n.Body, n.Type)
			if err != nil {
				log.Printf("Seed: notification error: %v", err)
			}
		}
		_ = readAt
	}
	log.Printf("Seed: created notifications for user %s", userID)
}

func seedBudgets(ctx context.Context, pool *pgxpool.Pool, userID string) {
	budgets := []struct {
		Label, Icon, Color string
		Limit, Spent       int64
	}{
		{"Comida", "utensils", "#f97316", 8000000, 4500000},
		{"Transporte", "car", "#3b82f6", 3000000, 1250000},
		{"Entretenimiento", "gamepad-2", "#a855f7", 2500000, 800000},
		{"Servicios", "zap", "#eab308", 6000000, 3245000},
	}
	for _, b := range budgets {
		_, err := pool.Exec(ctx,
			`INSERT INTO budgets (id, user_id, label, amount_limit, amount_spent, icon, color)
			 VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING`,
			uuid.New().String(), userID, b.Label, b.Limit, b.Spent, b.Icon, b.Color)
		if err != nil {
			log.Printf("Seed: budget error: %v", err)
		}
	}
	log.Printf("Seed: created budgets for user %s", userID)
}

func seedRecurringPayments(ctx context.Context, pool *pgxpool.Pool, userID string) {
	payments := []struct {
		Label, Type, Frequency, NextDate string
		Amount                           int64
		Phone, Name, Provider, ClientID  string
		Enabled                          bool
	}{
		{"Pago ICE", "service", "monthly", "2026-03-15", 3245000, "", "", "ice", "1234567", true},
		{"SINPE a Diego", "sinpe", "biweekly", "2026-03-01", 1500000, "+50688881234", "Diego Mora", "", "", true},
		{"Recarga Kolbi", "recharge", "monthly", "2026-03-20", 500000, "+50688880000", "", "", "", false},
	}
	for _, p := range payments {
		_, err := pool.Exec(ctx,
			`INSERT INTO recurring_payments (id, user_id, label, type, amount, frequency, next_date,
			 recipient_phone, recipient_name, service_provider_id, client_id, enabled)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, NULLIF($8, ''), NULLIF($9, ''), NULLIF($10, ''), NULLIF($11, ''), $12)
			 ON CONFLICT DO NOTHING`,
			uuid.New().String(), userID, p.Label, p.Type, p.Amount, p.Frequency, p.NextDate,
			p.Phone, p.Name, p.Provider, p.ClientID, p.Enabled)
		if err != nil {
			log.Printf("Seed: recurring payment error: %v", err)
		}
	}
	log.Printf("Seed: created recurring payments for user %s", userID)
}

func seedLoyalty(ctx context.Context, pool *pgxpool.Pool, userID string) {
	// 1. Create loyalty account
	_, err := pool.Exec(ctx,
		`INSERT INTO loyalty_accounts (id, user_id, total_points, available_points, lifetime_points, tier)
		 VALUES ($1, $2, 4250, 3100, 4250, 'silver') ON CONFLICT (user_id) DO NOTHING`,
		uuid.New().String(), userID)
	if err != nil {
		log.Printf("Seed: loyalty account error: %v", err)
	}

	// 2. Cashback rules (internal)
	rules := []struct {
		Category   string
		Percentage float64
		MaxPoints  int64
	}{
		{"sinpe", 1.0, 200},
		{"services", 1.5, 300},
		{"crypto", 0.5, 100},
		{"recharge", 2.0, 150},
		{"qr_payment", 1.0, 250},
	}
	for _, r := range rules {
		_, err := pool.Exec(ctx,
			`INSERT INTO cashback_rules (id, category, percentage, max_points_per_tx, active)
			 VALUES ($1, $2, $3, $4, true) ON CONFLICT (category) DO NOTHING`,
			uuid.New().String(), r.Category, r.Percentage, r.MaxPoints)
		if err != nil {
			log.Printf("Seed: cashback rule error: %v", err)
		}
	}

	// 3. Internal rewards catalog (no external partners)
	rewards := []struct {
		Name, Description, Category string
		PointsCost                  int64
		Stock                       int
	}{
		{"Cashback ₡500", "₡500 de vuelta a tu cuenta CRC", "discount", 500, -1},
		{"Cashback ₡1,000", "₡1,000 de vuelta a tu cuenta CRC", "discount", 900, -1},
		{"Cashback ₡2,500", "₡2,500 de vuelta a tu cuenta CRC", "discount", 2000, -1},
		{"Cashback ₡5,000", "₡5,000 de vuelta a tu cuenta CRC", "discount", 3800, -1},
		{"SINPE gratis x5", "5 transferencias SINPE sin comision", "voucher", 750, -1},
		{"SINPE gratis x10", "10 transferencias SINPE sin comision", "voucher", 1200, -1},
		{"Recarga doble", "Tu proxima recarga se duplica (hasta ₡5,000)", "voucher", 1500, 50},
		{"Puntos dobles 24h", "Gana el doble de puntos por 24 horas", "voucher", 2000, 30},
		{"Comision crypto 0%", "Una operacion crypto sin comision", "voucher", 1000, -1},
		{"Nivel VIP 7 dias", "Acceso a beneficios Gold por 7 dias", "experience", 5000, 10},
	}
	for _, r := range rewards {
		_, err := pool.Exec(ctx,
			`INSERT INTO loyalty_rewards (id, name, description, category, points_cost, stock, active)
			 VALUES ($1, $2, $3, $4, $5, $6, true) ON CONFLICT DO NOTHING`,
			uuid.New().String(), r.Name, r.Description, r.Category, r.PointsCost, r.Stock)
		if err != nil {
			log.Printf("Seed: loyalty reward error: %v", err)
		}
	}

	// 4. Points history
	txs := []struct {
		Type, Description, RefType string
		Points                     int64
	}{
		{"earn", "Bono de bienvenida", "bonus", 1000},
		{"earn", "Pago ICE - 1.5% cashback", "services", 490},
		{"earn", "SINPE a Diego Mora - 1% cashback", "sinpe", 250},
		{"earn", "Recarga Kolbi - 2% cashback", "recharge", 100},
		{"earn", "Pago QR Auto Mercado - 1% cashback", "qr_payment", 185},
		{"earn", "SINPE a Maria - 1% cashback", "sinpe", 150},
		{"earn", "Uber Eats - 1.5% cashback", "services", 192},
		{"earn", "Referido: Carlos Jimenez", "bonus", 500},
		{"earn", "Compra BTC - 0.5% cashback", "crypto", 233},
		{"redeem", "Canje: Cashback ₡500", "redemption", 500},
		{"earn", "Pago AyA - 1.5% cashback", "services", 150},
		{"redeem", "Canje: SINPE gratis x5", "redemption", 750},
		{"earn", "Bono actividad mensual", "bonus", 300},
	}
	for _, tx := range txs {
		_, err := pool.Exec(ctx,
			`INSERT INTO loyalty_transactions (id, user_id, type, points, description, ref_type)
			 VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
			uuid.New().String(), userID, tx.Type, tx.Points, tx.Description, tx.RefType)
		if err != nil {
			log.Printf("Seed: loyalty tx error: %v", err)
		}
	}
	log.Printf("Seed: created loyalty data for user %s", userID)
}
