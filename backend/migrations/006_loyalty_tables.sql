-- KiramoPay Migration 006: Loyalty & Rewards tables
-- Phase 5: Marketplace & Expansion

-- ============================================================================
-- 1. LOYALTY ACCOUNTS (points balance per user)
-- ============================================================================

CREATE TABLE IF NOT EXISTS loyalty_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,

    total_points BIGINT DEFAULT 0,
    available_points BIGINT DEFAULT 0,
    lifetime_points BIGINT DEFAULT 0,
    tier VARCHAR(20) DEFAULT 'bronze', -- bronze, silver, gold, platinum

    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================================
-- 2. LOYALTY TRANSACTIONS (points history)
-- ============================================================================

CREATE TABLE IF NOT EXISTS loyalty_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    type VARCHAR(20) NOT NULL,      -- earn, redeem, expire, bonus
    points BIGINT NOT NULL,
    description TEXT DEFAULT '',
    ref_type VARCHAR(30),           -- transaction, sinpe, service, ride, food_order, redemption
    ref_id VARCHAR(100),

    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_loyalty_tx_user ON loyalty_transactions(user_id, created_at DESC);

-- ============================================================================
-- 3. CASHBACK RULES
-- ============================================================================

CREATE TABLE IF NOT EXISTS cashback_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category VARCHAR(30) NOT NULL UNIQUE, -- transaction, sinpe, service, marketplace, crypto
    percentage DOUBLE PRECISION NOT NULL,
    max_points_per_tx BIGINT DEFAULT 500,
    active BOOLEAN DEFAULT TRUE,

    created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================================
-- 4. LOYALTY REWARDS CATALOG
-- ============================================================================

CREATE TABLE IF NOT EXISTS loyalty_rewards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(200) NOT NULL,
    description TEXT DEFAULT '',
    category VARCHAR(30) NOT NULL, -- discount, voucher, gift_card, experience
    points_cost BIGINT NOT NULL,
    image_url VARCHAR(500) DEFAULT '',
    partner_code VARCHAR(50) REFERENCES marketplace_partners(code),
    active BOOLEAN DEFAULT TRUE,
    stock INTEGER DEFAULT -1, -- -1 = unlimited
    expires_at TIMESTAMP,

    created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================================
-- 5. REDEMPTIONS
-- ============================================================================

CREATE TABLE IF NOT EXISTS loyalty_redemptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reward_id UUID NOT NULL REFERENCES loyalty_rewards(id),
    points BIGINT NOT NULL,
    status VARCHAR(20) DEFAULT 'pending', -- pending, completed, cancelled
    code VARCHAR(50),

    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_loyalty_redemptions_user ON loyalty_redemptions(user_id, created_at DESC);
