-- KiramoPay Initial Schema
-- Phase 1: Users, Authentication, Wallets

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- 1. USERS
-- ============================================================================

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Costa Rica identification
    cedula VARCHAR(12) UNIQUE,
    cedula_type VARCHAR(20) DEFAULT 'nacional', -- 'nacional', 'residente', 'dimex', 'passport'

    -- Contact
    phone VARCHAR(15) NOT NULL UNIQUE,
    phone_verified BOOLEAN DEFAULT FALSE,
    email VARCHAR(255) UNIQUE,
    email_verified BOOLEAN DEFAULT FALSE,

    -- Profile
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    birth_date DATE,
    profile_picture_url TEXT,

    -- Security
    pin_hash VARCHAR(255) NOT NULL, -- Argon2id hash
    biometric_enabled BOOLEAN DEFAULT FALSE,
    biometric_public_key TEXT,

    -- KYC (Know Your Customer)
    kyc_level INTEGER DEFAULT 0,      -- 0: basic, 1: verified, 2: complete
    kyc_status VARCHAR(20) DEFAULT 'pending',
    kyc_verified_at TIMESTAMP,

    -- Status
    status VARCHAR(20) DEFAULT 'active', -- active, suspended, blocked

    -- Timestamps
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    last_login_at TIMESTAMP,

    -- Soft delete
    deleted_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
CREATE INDEX IF NOT EXISTS idx_users_cedula ON users(cedula);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);

-- ============================================================================
-- 2. USER DEVICES
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    device_id VARCHAR(255) NOT NULL,
    device_name VARCHAR(100),
    device_type VARCHAR(50),    -- 'ios', 'android', 'web'
    device_model VARCHAR(100),
    os_version VARCHAR(50),
    app_version VARCHAR(20),

    push_token TEXT,

    is_trusted BOOLEAN DEFAULT FALSE,
    last_used_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),

    UNIQUE(user_id, device_id)
);

-- ============================================================================
-- 3. USER SESSIONS
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_id UUID REFERENCES user_devices(id),

    token_hash VARCHAR(255) NOT NULL,
    refresh_token_hash VARCHAR(255),

    ip_address INET,
    user_agent TEXT,

    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    revoked_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON user_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON user_sessions(expires_at) WHERE revoked_at IS NULL;

-- ============================================================================
-- 4. OTP VERIFICATIONS
-- ============================================================================

CREATE TABLE IF NOT EXISTS otp_verifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    phone VARCHAR(15) NOT NULL,
    otp_hash VARCHAR(255) NOT NULL,
    purpose VARCHAR(50) NOT NULL, -- 'register', 'login', 'transaction'

    attempts INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 3,

    expires_at TIMESTAMP NOT NULL,
    verified_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_otp_phone ON otp_verifications(phone, purpose);

-- ============================================================================
-- 5. WALLETS
-- ============================================================================

CREATE TABLE IF NOT EXISTS wallets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,

    -- Balances in centimos (to avoid floating point issues)
    balance_crc BIGINT DEFAULT 0, -- Colones
    balance_usd BIGINT DEFAULT 0, -- USD cents

    -- Dynamic limits based on KYC level
    daily_limit BIGINT DEFAULT 50000000,    -- 500,000 CRC default
    monthly_limit BIGINT DEFAULT 500000000, -- 5,000,000 CRC

    -- Usage counters
    daily_spent BIGINT DEFAULT 0,
    monthly_spent BIGINT DEFAULT 0,
    last_daily_reset DATE DEFAULT CURRENT_DATE,
    last_monthly_reset DATE DEFAULT DATE_TRUNC('month', CURRENT_DATE)::DATE,

    -- Optimistic locking
    version INTEGER DEFAULT 1,

    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wallets_user ON wallets(user_id);

-- ============================================================================
-- 6. LINKED BANK ACCOUNTS
-- ============================================================================

CREATE TABLE IF NOT EXISTS linked_bank_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    bank_code VARCHAR(10) NOT NULL,
    bank_name VARCHAR(100) NOT NULL,

    account_type VARCHAR(20), -- 'checking', 'savings'
    account_number_encrypted BYTEA,
    iban_encrypted BYTEA,

    sinpe_phone VARCHAR(15),

    is_primary BOOLEAN DEFAULT FALSE,
    is_verified BOOLEAN DEFAULT FALSE,

    nickname VARCHAR(50),

    created_at TIMESTAMP DEFAULT NOW(),
    verified_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_bank_accounts_user ON linked_bank_accounts(user_id);

-- ============================================================================
-- 7. TRANSACTIONS (Partitioned by month)
-- ============================================================================

CREATE TABLE IF NOT EXISTS transactions (
    id UUID DEFAULT gen_random_uuid(),

    wallet_id UUID NOT NULL,
    user_id UUID NOT NULL,

    -- Transaction type
    type VARCHAR(30) NOT NULL,
    -- Types: 'sinpe_send', 'sinpe_receive', 'qr_payment', 'qr_receive',
    --        'bill_payment', 'recharge', 'deposit', 'withdrawal',
    --        'p2p_send', 'p2p_receive', 'marketplace', 'refund'

    -- Amounts in centimos
    amount BIGINT NOT NULL,
    currency VARCHAR(3) DEFAULT 'CRC',
    fee BIGINT DEFAULT 0,

    -- Counterparty details
    counterparty_type VARCHAR(20), -- 'user', 'merchant', 'service', 'bank'
    counterparty_id UUID,
    counterparty_name VARCHAR(100),
    counterparty_phone VARCHAR(15),
    counterparty_account VARCHAR(50),

    -- Status
    status VARCHAR(20) DEFAULT 'pending',
    -- States: 'pending', 'processing', 'completed', 'failed', 'reversed'

    -- External references
    external_reference VARCHAR(100),

    -- Flexible metadata
    metadata JSONB DEFAULT '{}',

    -- Geolocation (optional)
    location_lat DECIMAL(10, 8),
    location_lng DECIMAL(11, 8),

    -- Audit timestamps
    created_at TIMESTAMP DEFAULT NOW(),
    processed_at TIMESTAMP,
    completed_at TIMESTAMP,

    -- Partition key
    created_date DATE DEFAULT CURRENT_DATE,

    PRIMARY KEY (id, created_date)
) PARTITION BY RANGE (created_date);

-- Create partitions for 2025-2026
CREATE TABLE IF NOT EXISTS transactions_2025_01 PARTITION OF transactions FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');
CREATE TABLE IF NOT EXISTS transactions_2025_02 PARTITION OF transactions FOR VALUES FROM ('2025-02-01') TO ('2025-03-01');
CREATE TABLE IF NOT EXISTS transactions_2025_03 PARTITION OF transactions FOR VALUES FROM ('2025-03-01') TO ('2025-04-01');
CREATE TABLE IF NOT EXISTS transactions_2025_04 PARTITION OF transactions FOR VALUES FROM ('2025-04-01') TO ('2025-05-01');
CREATE TABLE IF NOT EXISTS transactions_2025_05 PARTITION OF transactions FOR VALUES FROM ('2025-05-01') TO ('2025-06-01');
CREATE TABLE IF NOT EXISTS transactions_2025_06 PARTITION OF transactions FOR VALUES FROM ('2025-06-01') TO ('2025-07-01');
CREATE TABLE IF NOT EXISTS transactions_2025_07 PARTITION OF transactions FOR VALUES FROM ('2025-07-01') TO ('2025-08-01');
CREATE TABLE IF NOT EXISTS transactions_2025_08 PARTITION OF transactions FOR VALUES FROM ('2025-08-01') TO ('2025-09-01');
CREATE TABLE IF NOT EXISTS transactions_2025_09 PARTITION OF transactions FOR VALUES FROM ('2025-09-01') TO ('2025-10-01');
CREATE TABLE IF NOT EXISTS transactions_2025_10 PARTITION OF transactions FOR VALUES FROM ('2025-10-01') TO ('2025-11-01');
CREATE TABLE IF NOT EXISTS transactions_2025_11 PARTITION OF transactions FOR VALUES FROM ('2025-11-01') TO ('2025-12-01');
CREATE TABLE IF NOT EXISTS transactions_2025_12 PARTITION OF transactions FOR VALUES FROM ('2025-12-01') TO ('2026-01-01');
CREATE TABLE IF NOT EXISTS transactions_2026_01 PARTITION OF transactions FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
CREATE TABLE IF NOT EXISTS transactions_2026_02 PARTITION OF transactions FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');
CREATE TABLE IF NOT EXISTS transactions_2026_03 PARTITION OF transactions FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');
CREATE TABLE IF NOT EXISTS transactions_2026_04 PARTITION OF transactions FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');
CREATE TABLE IF NOT EXISTS transactions_2026_05 PARTITION OF transactions FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE IF NOT EXISTS transactions_2026_06 PARTITION OF transactions FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE IF NOT EXISTS transactions_2026_07 PARTITION OF transactions FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE IF NOT EXISTS transactions_2026_08 PARTITION OF transactions FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE IF NOT EXISTS transactions_2026_09 PARTITION OF transactions FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE IF NOT EXISTS transactions_2026_10 PARTITION OF transactions FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE IF NOT EXISTS transactions_2026_11 PARTITION OF transactions FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE IF NOT EXISTS transactions_2026_12 PARTITION OF transactions FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');

-- Transaction indexes
CREATE INDEX IF NOT EXISTS idx_tx_wallet ON transactions(wallet_id, created_date);
CREATE INDEX IF NOT EXISTS idx_tx_user ON transactions(user_id, created_date);
CREATE INDEX IF NOT EXISTS idx_tx_status ON transactions(status, created_date);
CREATE INDEX IF NOT EXISTS idx_tx_type ON transactions(type, created_date);
CREATE INDEX IF NOT EXISTS idx_tx_external ON transactions(external_reference) WHERE external_reference IS NOT NULL;

-- ============================================================================
-- 8. TRIGGER: Auto-update wallet balance on transaction completion
-- ============================================================================

CREATE OR REPLACE FUNCTION update_wallet_balance()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'completed' AND OLD.status != 'completed' THEN
        UPDATE wallets
        SET balance_crc = balance_crc +
            CASE
                WHEN NEW.currency = 'CRC' AND NEW.type IN ('sinpe_receive', 'qr_receive', 'p2p_receive', 'deposit', 'refund')
                THEN NEW.amount
                WHEN NEW.currency = 'CRC'
                THEN -(NEW.amount + NEW.fee)
                ELSE 0
            END,
            balance_usd = balance_usd +
            CASE
                WHEN NEW.currency = 'USD' AND NEW.type IN ('sinpe_receive', 'qr_receive', 'p2p_receive', 'deposit', 'refund')
                THEN NEW.amount
                WHEN NEW.currency = 'USD'
                THEN -(NEW.amount + NEW.fee)
                ELSE 0
            END,
            daily_spent = daily_spent +
            CASE
                WHEN NEW.type IN ('sinpe_send', 'qr_payment', 'bill_payment', 'recharge', 'p2p_send')
                THEN NEW.amount
                ELSE 0
            END,
            updated_at = NOW(),
            version = version + 1
        WHERE user_id = NEW.user_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to all existing and future partitions
DO $$
DECLARE
    partition_name TEXT;
BEGIN
    FOR partition_name IN
        SELECT inhrelid::regclass::text
        FROM pg_inherits
        WHERE inhparent = 'transactions'::regclass
    LOOP
        EXECUTE format(
            'CREATE TRIGGER trigger_update_balance_%s
             AFTER UPDATE ON %I
             FOR EACH ROW EXECUTE FUNCTION update_wallet_balance()',
            replace(partition_name, 'public.', ''),
            partition_name
        );
    END LOOP;
END;
$$;

-- ============================================================================
-- 9. HELPER: Auto-reset daily/monthly spending counters
-- ============================================================================

CREATE OR REPLACE FUNCTION reset_spending_counters()
RETURNS void AS $$
BEGIN
    -- Reset daily
    UPDATE wallets
    SET daily_spent = 0, last_daily_reset = CURRENT_DATE
    WHERE last_daily_reset < CURRENT_DATE;

    -- Reset monthly
    UPDATE wallets
    SET monthly_spent = 0, last_monthly_reset = DATE_TRUNC('month', CURRENT_DATE)::DATE
    WHERE last_monthly_reset < DATE_TRUNC('month', CURRENT_DATE)::DATE;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 10. SERVICE PROVIDERS
-- ============================================================================

CREATE TABLE IF NOT EXISTS service_providers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    code VARCHAR(20) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    category VARCHAR(50) NOT NULL, -- 'electricity', 'water', 'telecom', 'internet'

    logo_url TEXT,

    api_endpoint TEXT,
    api_type VARCHAR(20), -- 'rest', 'soap', 'sinpe'

    client_id_pattern VARCHAR(100),
    client_id_label VARCHAR(50),

    is_active BOOLEAN DEFAULT TRUE,

    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================================
-- 11. SEED DATA: Test users (development only)
-- ============================================================================

-- Insert test users with pre-hashed PINs
-- PIN "1234" hashed with Argon2id (placeholder — real hash generated at runtime)
-- PIN "0000" hashed with Argon2id (placeholder — real hash generated at runtime)

-- Note: In development, the API service seeds these on first start.
-- In production, these should not exist.
