-- KiramoPay Migration 008: Split Payment tables
-- Phase 5: Marketplace & Expansion

-- ============================================================================
-- 1. SPLIT GROUPS
-- ============================================================================

CREATE TABLE IF NOT EXISTS split_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    creator_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(200) NOT NULL,
    description TEXT,
    total_amount BIGINT NOT NULL,     -- centimos
    currency VARCHAR(10) DEFAULT 'CRC',
    split_type VARCHAR(20) NOT NULL,  -- equal, custom, percentage
    status VARCHAR(20) DEFAULT 'active', -- active, settled, cancelled
    created_at TIMESTAMP DEFAULT NOW(),
    settled_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_split_groups_creator ON split_groups(creator_id, created_at DESC);

-- ============================================================================
-- 2. SPLIT SHARES
-- ============================================================================

CREATE TABLE IF NOT EXISTS split_shares (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id UUID NOT NULL REFERENCES split_groups(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    user_phone VARCHAR(20),
    user_name VARCHAR(100) NOT NULL,
    amount BIGINT NOT NULL,           -- centimos
    status VARCHAR(20) DEFAULT 'pending', -- pending, paid, declined
    paid_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_split_shares_group ON split_shares(group_id);
CREATE INDEX IF NOT EXISTS idx_split_shares_user ON split_shares(user_id, status);
