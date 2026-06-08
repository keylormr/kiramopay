// Package testutil provides helpers for integration tests.
// Tests require a running PostgreSQL and Redis. Set TEST_DB_DSN and TEST_REDIS_ADDR
// environment variables, or use the defaults (localhost with docker-compose).
package testutil

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

// TestDB returns a pgxpool connected to the test database.
// It creates all tables and truncates them after the test.
func TestDB(t *testing.T) *pgxpool.Pool {
	t.Helper()

	dsn := os.Getenv("TEST_DB_DSN")
	if dsn == "" {
		dsn = "postgres://kiramopay:kiramopay_dev@localhost:5432/kiramopay_test?sslmode=disable"
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Skipf("Skipping integration test: cannot connect to test DB: %v", err)
	}

	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		t.Skipf("Skipping integration test: cannot ping test DB: %v", err)
	}

	if err := createSchema(ctx, pool); err != nil {
		pool.Close()
		t.Fatalf("Failed to create schema: %v", err)
	}

	truncateAll(ctx, pool)

	t.Cleanup(func() {
		truncateAll(context.Background(), pool)
		pool.Close()
	})

	return pool
}

// TestRedis returns a Redis client connected to the test instance.
func TestRedis(t *testing.T) *redis.Client {
	t.Helper()

	addr := os.Getenv("TEST_REDIS_ADDR")
	if addr == "" {
		addr = "localhost:6379"
	}

	client := redis.NewClient(&redis.Options{
		Addr: addr,
		DB:   15,
	})

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := client.Ping(ctx).Err(); err != nil {
		client.Close()
		t.Skipf("Skipping integration test: cannot connect to Redis: %v", err)
	}

	client.FlushDB(ctx)

	t.Cleanup(func() {
		client.FlushDB(context.Background())
		client.Close()
	})

	return client
}

func createSchema(ctx context.Context, pool *pgxpool.Pool) error {
	schema := `
	CREATE EXTENSION IF NOT EXISTS "pgcrypto";

	CREATE TABLE IF NOT EXISTS users (
		id UUID PRIMARY KEY,
		cedula VARCHAR(20) UNIQUE NOT NULL,
		phone VARCHAR(20) NOT NULL,
		phone_verified BOOLEAN DEFAULT false,
		email VARCHAR(255),
		email_verified BOOLEAN DEFAULT false,
		first_name VARCHAR(100) NOT NULL,
		last_name VARCHAR(100) NOT NULL,
		birth_date DATE,
		profile_picture_url TEXT,
		password_hash TEXT NOT NULL,
		biometric_enabled BOOLEAN DEFAULT false,
		kyc_level INT DEFAULT 0,
		kyc_status VARCHAR(20) DEFAULT 'pending',
		kyc_verified_at TIMESTAMPTZ,
		role VARCHAR(20) NOT NULL DEFAULT 'user',
		status VARCHAR(20) DEFAULT 'active',
		created_at TIMESTAMPTZ DEFAULT NOW(),
		updated_at TIMESTAMPTZ DEFAULT NOW(),
		last_login_at TIMESTAMPTZ,
		deleted_at TIMESTAMPTZ
	);

	CREATE TABLE IF NOT EXISTS wallets (
		id UUID PRIMARY KEY,
		user_id UUID UNIQUE NOT NULL REFERENCES users(id),
		balance_crc BIGINT DEFAULT 250000000,
		balance_usd BIGINT DEFAULT 50000,
		daily_limit BIGINT DEFAULT 100000000,
		monthly_limit BIGINT DEFAULT 500000000,
		daily_spent BIGINT DEFAULT 0,
		monthly_spent BIGINT DEFAULT 0,
		status VARCHAR(20) DEFAULT 'active',
		version INT DEFAULT 1,
		created_at TIMESTAMPTZ DEFAULT NOW(),
		updated_at TIMESTAMPTZ DEFAULT NOW()
	);

	CREATE TABLE IF NOT EXISTS user_sessions (
		id UUID PRIMARY KEY,
		user_id UUID NOT NULL REFERENCES users(id),
		access_jti UUID,
		refresh_jti UUID,
		device_fingerprint VARCHAR(128),
		token_hash TEXT,
		refresh_token_hash TEXT,
		ip_address INET,
		user_agent TEXT,
		expires_at TIMESTAMPTZ NOT NULL,
		revoked_at TIMESTAMPTZ,
		created_at TIMESTAMPTZ DEFAULT NOW()
	);

	CREATE TABLE IF NOT EXISTS refresh_tokens (
		jti UUID PRIMARY KEY,
		user_id UUID NOT NULL REFERENCES users(id),
		parent_jti UUID,
		family_id UUID NOT NULL,
		token_hash VARCHAR(128) NOT NULL,
		issued_at TIMESTAMPTZ DEFAULT NOW(),
		expires_at TIMESTAMPTZ NOT NULL,
		used_at TIMESTAMPTZ,
		revoked_at TIMESTAMPTZ,
		ip_address INET,
		user_agent TEXT
	);

	CREATE TABLE IF NOT EXISTS password_reset_tokens (
		id UUID PRIMARY KEY,
		user_id UUID NOT NULL REFERENCES users(id),
		token_hash VARCHAR(128) NOT NULL UNIQUE,
		requested_ip INET,
		expires_at TIMESTAMPTZ NOT NULL,
		used_at TIMESTAMPTZ,
		created_at TIMESTAMPTZ DEFAULT NOW()
	);

	CREATE TABLE IF NOT EXISTS mfa_challenges (
		id UUID PRIMARY KEY,
		user_id UUID NOT NULL REFERENCES users(id),
		purpose VARCHAR(32) NOT NULL,
		code_hash VARCHAR(128) NOT NULL,
		metadata JSONB DEFAULT '{}',
		attempts INT DEFAULT 0,
		max_attempts INT DEFAULT 3,
		verified_at TIMESTAMPTZ,
		expires_at TIMESTAMPTZ NOT NULL,
		created_at TIMESTAMPTZ DEFAULT NOW()
	);

	CREATE TABLE IF NOT EXISTS transactions (
		id UUID PRIMARY KEY,
		wallet_id UUID NOT NULL,
		user_id UUID NOT NULL,
		type VARCHAR(30) NOT NULL,
		amount BIGINT NOT NULL,
		currency VARCHAR(3) DEFAULT 'CRC',
		fee BIGINT DEFAULT 0,
		counterparty_type VARCHAR(30),
		counterparty_id UUID,
		counterparty_name VARCHAR(200),
		counterparty_phone VARCHAR(20),
		status VARCHAR(20) DEFAULT 'pending',
		external_reference VARCHAR(100),
		metadata JSONB DEFAULT '{}',
		idempotency_key VARCHAR(80),
		created_at TIMESTAMPTZ DEFAULT NOW(),
		processed_at TIMESTAMPTZ,
		completed_at TIMESTAMPTZ,
		created_date DATE DEFAULT CURRENT_DATE,
		UNIQUE (user_id, idempotency_key)
	);

	-- ── Ledger ──────────────────────────────────────────────────────────
	CREATE TABLE IF NOT EXISTS ledger_accounts (
		id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
		code VARCHAR(64) NOT NULL UNIQUE,
		type VARCHAR(32) NOT NULL,
		user_id UUID,
		currency VARCHAR(3) NOT NULL,
		normal_balance VARCHAR(8) NOT NULL,
		metadata JSONB DEFAULT '{}',
		created_at TIMESTAMPTZ DEFAULT NOW()
	);
	CREATE UNIQUE INDEX IF NOT EXISTS uq_ledger_user_currency
		ON ledger_accounts (user_id, currency) WHERE type = 'user_wallet';

	INSERT INTO ledger_accounts (code, type, currency, normal_balance) VALUES
		('SYSTEM:FEES:CRC',      'system_fee', 'CRC', 'credit'),
		('SYSTEM:FEES:USD',      'system_fee', 'USD', 'credit'),
		('SYSTEM:SUSPENSE:CRC',  'suspense',   'CRC', 'credit'),
		('SYSTEM:SUSPENSE:USD',  'suspense',   'USD', 'credit'),
		('SYSTEM:EXTERNAL:CRC',  'external',   'CRC', 'credit'),
		('SYSTEM:RESERVE:CRC',   'reserve',    'CRC', 'debit'),
		('SYSTEM:RESERVE:USD',   'reserve',    'USD', 'debit')
	ON CONFLICT (code) DO NOTHING;

	CREATE TABLE IF NOT EXISTS journal_postings (
		id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
		tx_id UUID,
		posted_at TIMESTAMPTZ DEFAULT NOW(),
		description TEXT NOT NULL,
		metadata JSONB DEFAULT '{}',
		idempotency_key VARCHAR(80) UNIQUE,
		created_by UUID
	);

	CREATE TABLE IF NOT EXISTS journal_entries (
		id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
		posting_id UUID NOT NULL REFERENCES journal_postings(id),
		account_id UUID NOT NULL REFERENCES ledger_accounts(id),
		direction VARCHAR(8) NOT NULL,
		amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
		currency VARCHAR(3) NOT NULL,
		created_at TIMESTAMPTZ DEFAULT NOW()
	);

	CREATE OR REPLACE FUNCTION fn_journal_posting_balanced()
	RETURNS TRIGGER AS $$
	DECLARE
		unbalanced RECORD;
	BEGIN
		FOR unbalanced IN
			SELECT je.currency,
			       SUM(CASE WHEN je.direction='debit' THEN je.amount_minor ELSE 0 END) AS dr,
			       SUM(CASE WHEN je.direction='credit' THEN je.amount_minor ELSE 0 END) AS cr
			FROM journal_entries je
			WHERE je.posting_id = NEW.posting_id
			GROUP BY je.currency
			HAVING SUM(CASE WHEN je.direction='debit' THEN je.amount_minor ELSE 0 END)
				 <> SUM(CASE WHEN je.direction='credit' THEN je.amount_minor ELSE 0 END)
		LOOP
			RAISE EXCEPTION 'unbalanced posting %', NEW.posting_id;
		END LOOP;
		RETURN NULL;
	END;
	$$ LANGUAGE plpgsql;

	DROP TRIGGER IF EXISTS trg_journal_entries_balance ON journal_entries;
	CREATE CONSTRAINT TRIGGER trg_journal_entries_balance
		AFTER INSERT ON journal_entries
		DEFERRABLE INITIALLY DEFERRED
		FOR EACH ROW EXECUTE FUNCTION fn_journal_posting_balanced();

	CREATE OR REPLACE VIEW ledger_account_balances AS
	SELECT la.id AS account_id, la.code, la.type, la.user_id, la.currency, la.normal_balance,
		COALESCE(SUM(CASE WHEN je.direction='debit' THEN je.amount_minor ELSE 0 END), 0) AS total_debit,
		COALESCE(SUM(CASE WHEN je.direction='credit' THEN je.amount_minor ELSE 0 END), 0) AS total_credit,
		CASE la.normal_balance
			WHEN 'debit'  THEN COALESCE(SUM(CASE WHEN je.direction='debit'  THEN je.amount_minor ELSE -je.amount_minor END), 0)
			WHEN 'credit' THEN COALESCE(SUM(CASE WHEN je.direction='credit' THEN je.amount_minor ELSE -je.amount_minor END), 0)
		END AS balance_minor
	FROM ledger_accounts la
	LEFT JOIN journal_entries je ON je.account_id = la.id
	GROUP BY la.id, la.code, la.type, la.user_id, la.currency, la.normal_balance;

	CREATE OR REPLACE VIEW wallet_journal_drift AS
	SELECT w.user_id,
		w.balance_crc AS cache_crc,
		COALESCE(crc.balance_minor, 0) AS journal_crc,
		(w.balance_crc - COALESCE(crc.balance_minor, 0)) AS drift_crc,
		w.balance_usd AS cache_usd,
		COALESCE(usd.balance_minor, 0) AS journal_usd,
		(w.balance_usd - COALESCE(usd.balance_minor, 0)) AS drift_usd
	FROM wallets w
	LEFT JOIN ledger_account_balances crc ON crc.user_id = w.user_id AND crc.currency='CRC'
	LEFT JOIN ledger_account_balances usd ON usd.user_id = w.user_id AND usd.currency='USD';

	-- Other domains (kept minimal for cross-package tests)
	CREATE TABLE IF NOT EXISTS sinpe_contacts (
		id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
		user_id UUID NOT NULL REFERENCES users(id),
		phone VARCHAR(20) NOT NULL,
		name VARCHAR(200) NOT NULL,
		bank VARCHAR(100),
		is_favorite BOOLEAN DEFAULT false,
		created_at TIMESTAMPTZ DEFAULT NOW(),
		UNIQUE(user_id, phone)
	);

	CREATE TABLE IF NOT EXISTS sinpe_history (
		id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
		user_id UUID NOT NULL,
		phone VARCHAR(20) NOT NULL,
		contact_name VARCHAR(200),
		amount BIGINT NOT NULL,
		fee BIGINT DEFAULT 0,
		type VARCHAR(10) NOT NULL,
		status VARCHAR(20) DEFAULT 'completed',
		description TEXT,
		created_at TIMESTAMPTZ DEFAULT NOW()
	);

	-- Crypto (NUMERIC precision per migration 019).
	CREATE TABLE IF NOT EXISTS crypto_assets (
		id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
		user_id UUID NOT NULL,
		symbol VARCHAR(20) NOT NULL,
		name VARCHAR(100) NOT NULL,
		balance NUMERIC(38,18) DEFAULT 0,
		avg_cost NUMERIC(38,18) DEFAULT 0,
		created_at TIMESTAMPTZ DEFAULT NOW(),
		updated_at TIMESTAMPTZ DEFAULT NOW(),
		UNIQUE(user_id, symbol)
	);

	CREATE TABLE IF NOT EXISTS crypto_transactions (
		id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
		user_id UUID NOT NULL,
		type VARCHAR(20) NOT NULL,
		asset VARCHAR(40) NOT NULL,
		amount NUMERIC(38,18) NOT NULL,
		price NUMERIC(38,18) DEFAULT 0,
		total NUMERIC(38,18) DEFAULT 0,
		currency VARCHAR(10) NOT NULL,
		fee NUMERIC(38,18) DEFAULT 0,
		status VARCHAR(20) DEFAULT 'completed',
		created_at TIMESTAMPTZ DEFAULT NOW()
	);

	CREATE TABLE IF NOT EXISTS crypto_staking (
		id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
		user_id UUID NOT NULL,
		asset VARCHAR(20) NOT NULL,
		amount NUMERIC(38,18) NOT NULL,
		apy NUMERIC(8,4) DEFAULT 0,
		start_date TIMESTAMPTZ DEFAULT NOW(),
		locked BOOLEAN DEFAULT false,
		lock_days INT DEFAULT 0,
		earned NUMERIC(38,18) DEFAULT 0,
		status VARCHAR(20) DEFAULT 'active',
		created_at TIMESTAMPTZ DEFAULT NOW()
	);

	CREATE TABLE IF NOT EXISTS crypto_price_alerts (
		id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
		user_id UUID NOT NULL,
		asset VARCHAR(20) NOT NULL,
		target_price NUMERIC(38,18) NOT NULL,
		direction VARCHAR(10) NOT NULL,
		active BOOLEAN DEFAULT true,
		created_at TIMESTAMPTZ DEFAULT NOW()
	);

	-- KYC / AML (migration 025).
	CREATE TABLE IF NOT EXISTS kyc_verifications (
		id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
		user_id UUID NOT NULL REFERENCES users(id),
		level_requested INTEGER NOT NULL,
		status VARCHAR(20) NOT NULL DEFAULT 'pending',
		full_legal_name VARCHAR(200) NOT NULL,
		birth_date DATE,
		nationality VARCHAR(2),
		document_type VARCHAR(30) NOT NULL,
		document_number VARCHAR(60) NOT NULL,
		screening_result VARCHAR(20) NOT NULL DEFAULT 'pending',
		reviewer_notes TEXT,
		decided_by UUID REFERENCES users(id),
		submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
		decided_at TIMESTAMPTZ
	);

	CREATE TABLE IF NOT EXISTS kyc_documents (
		id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
		verification_id UUID NOT NULL REFERENCES kyc_verifications(id) ON DELETE CASCADE,
		doc_type VARCHAR(30) NOT NULL,
		file_ref TEXT NOT NULL,
		sha256 VARCHAR(64),
		uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
	);

	CREATE TABLE IF NOT EXISTS sanction_list (
		id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
		source VARCHAR(20) NOT NULL,
		full_name VARCHAR(200) NOT NULL,
		normalized_name VARCHAR(200) NOT NULL,
		birth_date DATE,
		nationality VARCHAR(2),
		program VARCHAR(100),
		added_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
	);

	CREATE TABLE IF NOT EXISTS sanction_screenings (
		id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
		user_id UUID REFERENCES users(id),
		verification_id UUID REFERENCES kyc_verifications(id) ON DELETE SET NULL,
		query_name VARCHAR(200) NOT NULL,
		normalized_query VARCHAR(200) NOT NULL,
		result VARCHAR(20) NOT NULL,
		match_count INTEGER NOT NULL DEFAULT 0,
		matched_ids TEXT,
		screened_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
	);

	CREATE TABLE IF NOT EXISTS uif_reports (
		id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
		user_id UUID NOT NULL REFERENCES users(id),
		tx_id UUID,
		report_type VARCHAR(20) NOT NULL,
		amount_minor BIGINT NOT NULL,
		currency VARCHAR(10) NOT NULL,
		daily_total_minor BIGINT NOT NULL DEFAULT 0,
		reason TEXT NOT NULL,
		status VARCHAR(20) NOT NULL DEFAULT 'pending',
		reviewer_id UUID REFERENCES users(id),
		reviewer_notes TEXT,
		created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
		reviewed_at TIMESTAMPTZ
	);
	CREATE UNIQUE INDEX IF NOT EXISTS uq_uif_reports_tx_single
		ON uif_reports(tx_id, report_type) WHERE tx_id IS NOT NULL;

	-- Fraud (migration 010).
	CREATE TABLE IF NOT EXISTS fraud_rules (
		id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
		name VARCHAR(200) NOT NULL,
		description TEXT DEFAULT '',
		category VARCHAR(30) NOT NULL,
		condition JSONB NOT NULL,
		score_weight INTEGER NOT NULL,
		active BOOLEAN DEFAULT TRUE,
		created_at TIMESTAMP DEFAULT NOW()
	);
	CREATE TABLE IF NOT EXISTS fraud_assessments (
		id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
		user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		tx_type VARCHAR(30) NOT NULL,
		tx_id VARCHAR(100) NOT NULL,
		amount BIGINT NOT NULL,
		risk_score INTEGER NOT NULL,
		risk_level VARCHAR(20) NOT NULL,
		factors TEXT NOT NULL,
		action VARCHAR(20) NOT NULL,
		reviewed_by VARCHAR(100),
		reviewed_at TIMESTAMP,
		created_at TIMESTAMP DEFAULT NOW()
	);
	CREATE TABLE IF NOT EXISTS fraud_alerts (
		id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
		user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		assessment_id UUID NOT NULL REFERENCES fraud_assessments(id),
		type VARCHAR(30) NOT NULL,
		severity VARCHAR(20) NOT NULL,
		message TEXT NOT NULL,
		status VARCHAR(20) DEFAULT 'open',
		resolved_by VARCHAR(100),
		resolved_at TIMESTAMP,
		created_at TIMESTAMP DEFAULT NOW()
	);
	CREATE TABLE IF NOT EXISTS user_risk_profiles (
		id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
		user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
		overall_risk_score INTEGER DEFAULT 0,
		total_transactions BIGINT DEFAULT 0,
		total_flagged BIGINT DEFAULT 0,
		avg_tx_amount BIGINT DEFAULT 0,
		max_tx_amount BIGINT DEFAULT 0,
		last_activity_at TIMESTAMP DEFAULT NOW(),
		account_age_days INTEGER DEFAULT 0,
		is_restricted BOOLEAN DEFAULT FALSE,
		created_at TIMESTAMP DEFAULT NOW(),
		updated_at TIMESTAMP DEFAULT NOW()
	);

	INSERT INTO sanction_list (source, full_name, normalized_name, nationality, program)
	SELECT v.source, v.full_name, v.normalized_name, v.nationality, v.program
	FROM (VALUES
		('OFAC', 'Carlos Sancion Prueba',      'carlos sancion prueba',      'CR', 'SDN-TEST'),
		('UN',   'Ivan Testovich Blocklisted', 'ivan testovich blocklisted', 'RU', 'UNSC-TEST')
	) AS v(source, full_name, normalized_name, nationality, program)
	WHERE NOT EXISTS (SELECT 1 FROM sanction_list);
	`

	_, err := pool.Exec(ctx, schema)
	return err
}

func truncateAll(ctx context.Context, pool *pgxpool.Pool) {
	tables := []string{
		"sinpe_history", "sinpe_contacts",
		"crypto_price_alerts", "crypto_staking", "crypto_transactions", "crypto_assets",
		"uif_reports",
		"fraud_alerts", "fraud_assessments", "user_risk_profiles", "fraud_rules",
		"sanction_screenings", "kyc_documents", "kyc_verifications",
		"journal_entries", "journal_postings",
		"transactions",
		"mfa_challenges", "password_reset_tokens", "refresh_tokens",
		"user_sessions", "wallets",
		"ledger_accounts",
		"users",
	}
	for _, t := range tables {
		pool.Exec(ctx, fmt.Sprintf("TRUNCATE TABLE %s CASCADE", t))
	}
	// Re-seed system ledger accounts after truncate.
	pool.Exec(ctx, `
		INSERT INTO ledger_accounts (code, type, currency, normal_balance) VALUES
			('SYSTEM:FEES:CRC',      'system_fee', 'CRC', 'credit'),
			('SYSTEM:FEES:USD',      'system_fee', 'USD', 'credit'),
			('SYSTEM:SUSPENSE:CRC',  'suspense',   'CRC', 'credit'),
			('SYSTEM:SUSPENSE:USD',  'suspense',   'USD', 'credit'),
			('SYSTEM:EXTERNAL:CRC',  'external',   'CRC', 'credit'),
			('SYSTEM:RESERVE:CRC',   'reserve',    'CRC', 'debit'),
			('SYSTEM:RESERVE:USD',   'reserve',    'USD', 'debit')
		ON CONFLICT (code) DO NOTHING
	`)
}

// SeedTestUser creates a test user with wallet and returns the user ID.
func SeedTestUser(t *testing.T, pool *pgxpool.Pool, cedula, passwordHash string) string {
	t.Helper()

	userID := "00000000-0000-0000-0000-000000000001"
	walletID := "00000000-0000-0000-0000-000000000101"

	ctx := context.Background()

	if _, err := pool.Exec(ctx,
		`INSERT INTO users (id, cedula, phone, first_name, last_name, password_hash, status, kyc_level)
		 VALUES ($1, $2, '+50688881234', 'Test', 'User', $3, 'active', 1)
		 ON CONFLICT (id) DO NOTHING`,
		userID, cedula, passwordHash,
	); err != nil {
		t.Fatalf("Failed to seed test user: %v", err)
	}

	if _, err := pool.Exec(ctx,
		`INSERT INTO wallets (id, user_id, balance_crc, balance_usd)
		 VALUES ($1, $2, 250000000, 50000)
		 ON CONFLICT (user_id) DO NOTHING`,
		walletID, userID,
	); err != nil {
		t.Fatalf("Failed to seed test wallet: %v", err)
	}

	// Provision ledger accounts for this user.
	if _, err := pool.Exec(ctx,
		`INSERT INTO ledger_accounts (code, type, user_id, currency, normal_balance)
		 VALUES ('USER:'||$1||':CRC','user_wallet',$1::uuid,'CRC','credit'),
		        ('USER:'||$1||':USD','user_wallet',$1::uuid,'USD','credit')
		 ON CONFLICT (code) DO NOTHING`,
		userID,
	); err != nil {
		t.Fatalf("provision ledger accounts: %v", err)
	}

	// Seed opening balance in the journal so reconciliation matches.
	postID := "00000000-0000-0000-0000-000000000abc"
	_, _ = pool.Exec(ctx,
		`INSERT INTO journal_postings (id, description) VALUES ($1::uuid,'SEED_OPENING')
		 ON CONFLICT DO NOTHING`,
		postID,
	)
	_, _ = pool.Exec(ctx, `
		INSERT INTO journal_entries (posting_id, account_id, direction, amount_minor, currency)
		SELECT $1::uuid, la.id, 'credit', 250000000, 'CRC'
		FROM ledger_accounts la WHERE la.user_id = $2::uuid AND la.currency='CRC'`,
		postID, userID,
	)
	_, _ = pool.Exec(ctx, `
		INSERT INTO journal_entries (posting_id, account_id, direction, amount_minor, currency)
		SELECT $1::uuid, la.id, 'debit', 250000000, 'CRC'
		FROM ledger_accounts la WHERE la.code='SYSTEM:RESERVE:CRC'`,
		postID,
	)

	return userID
}

// SeedTestUser2 creates a second test user for transfer tests.
func SeedTestUser2(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()

	userID := "00000000-0000-0000-0000-000000000002"
	walletID := "00000000-0000-0000-0000-000000000102"

	ctx := context.Background()

	if _, err := pool.Exec(ctx,
		`INSERT INTO users (id, cedula, phone, first_name, last_name, password_hash, status, kyc_level, role)
		 VALUES ($1, '700000000', '+50688885678', 'Admin', 'User', 'dummy_hash', 'active', 1, 'admin')
		 ON CONFLICT (id) DO NOTHING`,
		userID,
	); err != nil {
		t.Fatalf("Failed to seed test user 2: %v", err)
	}

	if _, err := pool.Exec(ctx,
		`INSERT INTO wallets (id, user_id, balance_crc, balance_usd)
		 VALUES ($1, $2, 100000000, 20000)
		 ON CONFLICT (user_id) DO NOTHING`,
		walletID, userID,
	); err != nil {
		t.Fatalf("Failed to seed test wallet 2: %v", err)
	}

	_, _ = pool.Exec(ctx,
		`INSERT INTO ledger_accounts (code, type, user_id, currency, normal_balance)
		 VALUES ('USER:'||$1||':CRC','user_wallet',$1::uuid,'CRC','credit'),
		        ('USER:'||$1||':USD','user_wallet',$1::uuid,'USD','credit')
		 ON CONFLICT (code) DO NOTHING`,
		userID,
	)

	postID := "00000000-0000-0000-0000-000000000def"
	_, _ = pool.Exec(ctx,
		`INSERT INTO journal_postings (id, description) VALUES ($1::uuid,'SEED_OPENING_U2')
		 ON CONFLICT DO NOTHING`,
		postID,
	)
	_, _ = pool.Exec(ctx, `
		INSERT INTO journal_entries (posting_id, account_id, direction, amount_minor, currency)
		SELECT $1::uuid, la.id, 'credit', 100000000, 'CRC'
		FROM ledger_accounts la WHERE la.user_id = $2::uuid AND la.currency='CRC'`,
		postID, userID,
	)
	_, _ = pool.Exec(ctx, `
		INSERT INTO journal_entries (posting_id, account_id, direction, amount_minor, currency)
		SELECT $1::uuid, la.id, 'debit', 100000000, 'CRC'
		FROM ledger_accounts la WHERE la.code='SYSTEM:RESERVE:CRC'`,
		postID,
	)

	return userID
}
