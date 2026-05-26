-- KiramoPay Migration 007: QR Payment tables
-- Phase 5: Marketplace & Expansion

-- ============================================================================
-- 1. QR MERCHANTS (business profiles)
-- ============================================================================

CREATE TABLE IF NOT EXISTS qr_merchants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    description TEXT DEFAULT '',
    category VARCHAR(30) NOT NULL, -- restaurant, retail, services, food_truck, market
    logo_url VARCHAR(500),
    qr_code VARCHAR(50) NOT NULL UNIQUE,
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================================
-- 2. QR PAYMENT CODES
-- ============================================================================

CREATE TABLE IF NOT EXISTS qr_payment_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    creator_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(30) NOT NULL, -- merchant_fixed, merchant_dynamic, p2p_request, p2p_receive
    amount BIGINT DEFAULT 0,   -- centimos, 0 = payer enters amount
    currency VARCHAR(10) DEFAULT 'CRC',
    merchant_id UUID REFERENCES qr_merchants(id),
    note TEXT,
    qr_data TEXT NOT NULL UNIQUE,
    single_use BOOLEAN DEFAULT FALSE,
    used BOOLEAN DEFAULT FALSE,
    expires_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_qr_codes_creator ON qr_payment_codes(creator_id);
CREATE INDEX IF NOT EXISTS idx_qr_codes_data ON qr_payment_codes(qr_data);

-- ============================================================================
-- 3. QR PAYMENTS (payment transactions via QR)
-- ============================================================================

CREATE TABLE IF NOT EXISTS qr_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    qr_code_id UUID NOT NULL REFERENCES qr_payment_codes(id),
    payer_id UUID NOT NULL REFERENCES users(id),
    receiver_id UUID NOT NULL REFERENCES users(id),
    merchant_id UUID REFERENCES qr_merchants(id),
    amount BIGINT NOT NULL,      -- centimos
    currency VARCHAR(10) DEFAULT 'CRC',
    status VARCHAR(20) DEFAULT 'pending', -- pending, completed, failed, refunded
    note TEXT,
    tx_id VARCHAR(100),          -- linked to transactions table
    created_at TIMESTAMP DEFAULT NOW(),
    completed_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_qr_payments_payer ON qr_payments(payer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_qr_payments_receiver ON qr_payments(receiver_id, created_at DESC);
