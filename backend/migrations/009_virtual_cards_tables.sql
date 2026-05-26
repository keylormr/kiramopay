-- KiramoPay Migration 009: Virtual Cards tables
-- Phase 5: Marketplace & Expansion

-- ============================================================================
-- 1. VIRTUAL CARDS
-- ============================================================================

CREATE TABLE IF NOT EXISTS virtual_cards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    card_number VARCHAR(20) NOT NULL,  -- encrypted in production
    last4 VARCHAR(4) NOT NULL,
    expiry_month INTEGER NOT NULL,
    expiry_year INTEGER NOT NULL,
    cardholder_name VARCHAR(200) NOT NULL,
    brand VARCHAR(20) DEFAULT 'visa',      -- visa, mastercard
    type VARCHAR(20) DEFAULT 'virtual',     -- virtual, physical
    currency VARCHAR(10) DEFAULT 'CRC',
    status VARCHAR(20) DEFAULT 'active',    -- active, frozen, cancelled, expired

    daily_limit BIGINT DEFAULT 50000000,    -- 500,000 CRC centimos
    monthly_limit BIGINT DEFAULT 200000000, -- 2,000,000 CRC centimos
    atm_limit BIGINT DEFAULT 10000000,      -- 100,000 CRC centimos
    daily_spent BIGINT DEFAULT 0,
    monthly_spent BIGINT DEFAULT 0,

    provider_card_id VARCHAR(100),           -- Stripe/Marqeta external ID
    created_at TIMESTAMP DEFAULT NOW(),
    frozen_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_virtual_cards_user ON virtual_cards(user_id, status);

-- ============================================================================
-- 2. CARD TRANSACTIONS
-- ============================================================================

CREATE TABLE IF NOT EXISTS card_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    card_id UUID NOT NULL REFERENCES virtual_cards(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    amount BIGINT NOT NULL,           -- centimos
    currency VARCHAR(10) DEFAULT 'CRC',
    merchant_name VARCHAR(200) NOT NULL,
    category VARCHAR(30) NOT NULL,     -- retail, food, transport, online, atm
    status VARCHAR(20) NOT NULL,       -- approved, declined, refunded
    decline_reason VARCHAR(200),

    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_card_tx_card ON card_transactions(card_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_card_tx_user ON card_transactions(user_id, created_at DESC);

-- ============================================================================
-- 3. DAILY SPENDING RESET (scheduled job — run via cron)
-- ============================================================================

-- This function resets daily_spent at midnight. Run via pg_cron or external scheduler.
CREATE OR REPLACE FUNCTION reset_daily_card_spending() RETURNS void AS $$
BEGIN
    UPDATE virtual_cards SET daily_spent = 0 WHERE status = 'active';
END;
$$ LANGUAGE plpgsql;

-- Monthly spending reset (run 1st of each month)
CREATE OR REPLACE FUNCTION reset_monthly_card_spending() RETURNS void AS $$
BEGIN
    UPDATE virtual_cards SET monthly_spent = 0 WHERE status = 'active';
END;
$$ LANGUAGE plpgsql;
