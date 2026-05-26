-- KiramoPay Migration 011: Multi-Country Expansion
-- Phase 5: Marketplace & Expansion

-- ============================================================================
-- 1. COUNTRIES
-- ============================================================================

CREATE TABLE IF NOT EXISTS countries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(5) NOT NULL UNIQUE,         -- CR, PA, GT
    name VARCHAR(100) NOT NULL,
    currency VARCHAR(10) NOT NULL,            -- CRC, PAB, GTQ
    currency_symbol VARCHAR(10) NOT NULL,     -- ₡, B/., Q
    currency_name VARCHAR(100) NOT NULL,
    phone_prefix VARCHAR(10) NOT NULL,        -- +506, +507, +502
    flag_emoji VARCHAR(10) NOT NULL,
    active BOOLEAN DEFAULT TRUE,
    timezone VARCHAR(50) DEFAULT 'America/Costa_Rica',
    locale VARCHAR(10) DEFAULT 'es-CR',
    created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================================
-- 2. EXCHANGE RATES
-- ============================================================================

CREATE TABLE IF NOT EXISTS exchange_rates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    from_currency VARCHAR(10) NOT NULL,
    to_currency VARCHAR(10) NOT NULL,
    rate DOUBLE PRECISION NOT NULL,
    source VARCHAR(30) DEFAULT 'manual', -- bccr, manual, api
    updated_at TIMESTAMP DEFAULT NOW(),

    UNIQUE(from_currency, to_currency)
);

CREATE INDEX IF NOT EXISTS idx_exchange_rates ON exchange_rates(from_currency, to_currency);

-- ============================================================================
-- 3. REGIONAL WALLETS (one per user per country)
-- ============================================================================

CREATE TABLE IF NOT EXISTS regional_wallets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    country_code VARCHAR(5) NOT NULL REFERENCES countries(code),
    currency VARCHAR(10) NOT NULL,
    balance BIGINT DEFAULT 0,          -- smallest currency unit
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),

    UNIQUE(user_id, country_code)
);

CREATE INDEX IF NOT EXISTS idx_regional_wallets_user ON regional_wallets(user_id);

-- ============================================================================
-- 4. CROSS-BORDER TRANSFERS
-- ============================================================================

CREATE TABLE IF NOT EXISTS cross_border_transfers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sender_id UUID NOT NULL REFERENCES users(id),
    receiver_id UUID REFERENCES users(id),
    receiver_phone VARCHAR(20) NOT NULL,

    from_country VARCHAR(5) NOT NULL,
    to_country VARCHAR(5) NOT NULL,
    from_currency VARCHAR(10) NOT NULL,
    to_currency VARCHAR(10) NOT NULL,

    from_amount BIGINT NOT NULL,        -- smallest unit of source currency
    to_amount BIGINT NOT NULL,          -- smallest unit of target currency
    exchange_rate DOUBLE PRECISION NOT NULL,
    fee BIGINT NOT NULL,                -- in source currency smallest unit

    status VARCHAR(20) DEFAULT 'pending', -- pending, processing, completed, failed, cancelled
    compliance_status VARCHAR(20) DEFAULT 'pending', -- pending, approved, rejected

    created_at TIMESTAMP DEFAULT NOW(),
    completed_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_cross_border_sender ON cross_border_transfers(sender_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cross_border_receiver ON cross_border_transfers(receiver_id, created_at DESC);
