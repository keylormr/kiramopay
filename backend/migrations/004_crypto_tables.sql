-- KiramoPay Migration 004: Crypto tables
-- Phase 4: Crypto Integration

-- ============================================================================
-- 1. CRYPTO ASSETS (user holdings)
-- ============================================================================

CREATE TABLE IF NOT EXISTS crypto_assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    symbol VARCHAR(10) NOT NULL,
    name VARCHAR(100) NOT NULL,
    balance DOUBLE PRECISION DEFAULT 0,
    avg_cost DOUBLE PRECISION DEFAULT 0,

    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),

    UNIQUE(user_id, symbol)
);

CREATE INDEX IF NOT EXISTS idx_crypto_assets_user ON crypto_assets(user_id);

-- ============================================================================
-- 2. CRYPTO TRANSACTIONS
-- ============================================================================

CREATE TABLE IF NOT EXISTS crypto_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    type VARCHAR(20) NOT NULL,    -- buy, sell, convert, send, receive
    asset VARCHAR(20) NOT NULL,
    amount DOUBLE PRECISION NOT NULL,
    price DOUBLE PRECISION NOT NULL,
    total DOUBLE PRECISION NOT NULL,
    currency VARCHAR(10) NOT NULL,
    fee DOUBLE PRECISION DEFAULT 0,
    status VARCHAR(20) DEFAULT 'completed',

    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crypto_tx_user ON crypto_transactions(user_id, created_at DESC);

-- ============================================================================
-- 3. STAKING POSITIONS
-- ============================================================================

CREATE TABLE IF NOT EXISTS crypto_staking (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    asset VARCHAR(10) NOT NULL,
    amount DOUBLE PRECISION NOT NULL,
    apy DOUBLE PRECISION NOT NULL,
    start_date TIMESTAMP NOT NULL,
    locked BOOLEAN DEFAULT FALSE,
    lock_days INTEGER DEFAULT 0,
    earned DOUBLE PRECISION DEFAULT 0,
    status VARCHAR(20) DEFAULT 'active', -- active, completed, cancelled

    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crypto_staking_user ON crypto_staking(user_id, status);

-- ============================================================================
-- 4. PRICE ALERTS
-- ============================================================================

CREATE TABLE IF NOT EXISTS crypto_price_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    asset VARCHAR(10) NOT NULL,
    target_price DOUBLE PRECISION NOT NULL,
    direction VARCHAR(10) NOT NULL, -- above, below
    active BOOLEAN DEFAULT TRUE,

    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crypto_alerts_user ON crypto_price_alerts(user_id, active);
