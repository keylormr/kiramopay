-- KiramoPay Migration 003: Payment and recharge tables
-- Phase 3: Services & Payments

-- ============================================================================
-- 1. SAVED SERVICES (extends service_providers from 001)
-- ============================================================================

CREATE TABLE IF NOT EXISTS saved_services (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider_id UUID NOT NULL REFERENCES service_providers(id),

    client_id VARCHAR(50) NOT NULL,
    nickname VARCHAR(50),

    auto_pay_enabled BOOLEAN DEFAULT FALSE,
    auto_pay_max_amount BIGINT,

    created_at TIMESTAMP DEFAULT NOW(),

    UNIQUE(user_id, provider_id, client_id)
);

CREATE INDEX IF NOT EXISTS idx_saved_services_user ON saved_services(user_id);

-- ============================================================================
-- 2. PAYMENT HISTORY (unified bill + recharge history)
-- ============================================================================

CREATE TABLE IF NOT EXISTS payment_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    type VARCHAR(20) NOT NULL,          -- 'bill' or 'recharge'
    provider_code VARCHAR(20) NOT NULL,
    provider_name VARCHAR(100) NOT NULL,
    client_id VARCHAR(50) NOT NULL,

    amount BIGINT NOT NULL,
    status VARCHAR(20) DEFAULT 'completed',

    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_history_user ON payment_history(user_id, created_at DESC);
