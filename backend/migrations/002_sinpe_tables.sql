-- KiramoPay Migration 002: SINPE tables
-- Phase 2: SINPE contacts and history

-- ============================================================================
-- 1. SINPE CONTACTS
-- ============================================================================

CREATE TABLE IF NOT EXISTS sinpe_contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    phone VARCHAR(15) NOT NULL,
    name VARCHAR(100) NOT NULL,
    bank VARCHAR(100),

    is_favorite BOOLEAN DEFAULT FALSE,

    created_at TIMESTAMP DEFAULT NOW(),

    UNIQUE(user_id, phone)
);

CREATE INDEX IF NOT EXISTS idx_sinpe_contacts_user ON sinpe_contacts(user_id);

-- ============================================================================
-- 2. SINPE HISTORY
-- ============================================================================

CREATE TABLE IF NOT EXISTS sinpe_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    phone VARCHAR(15) NOT NULL,
    contact_name VARCHAR(100) NOT NULL,
    amount BIGINT NOT NULL,           -- In centimos (CRC)
    fee BIGINT DEFAULT 0,
    type VARCHAR(20) NOT NULL,        -- 'sent' or 'received'
    status VARCHAR(20) DEFAULT 'completed',
    description TEXT,

    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sinpe_history_user ON sinpe_history(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sinpe_history_daily ON sinpe_history(user_id, type, status, created_at)
    WHERE type = 'sent' AND status = 'completed';
