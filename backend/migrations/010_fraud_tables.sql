-- KiramoPay Migration 010: Fraud Detection tables
-- Phase 5: Marketplace & Expansion

-- ============================================================================
-- 1. FRAUD RULES (configurable risk rules)
-- ============================================================================

CREATE TABLE IF NOT EXISTS fraud_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(200) NOT NULL,
    description TEXT DEFAULT '',
    category VARCHAR(30) NOT NULL,     -- velocity, amount, pattern, device, location
    condition JSONB NOT NULL,           -- rule logic as JSON
    score_weight INTEGER NOT NULL,      -- points added to risk score
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================================
-- 2. FRAUD ASSESSMENTS (risk evaluations per transaction)
-- ============================================================================

CREATE TABLE IF NOT EXISTS fraud_assessments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tx_type VARCHAR(30) NOT NULL,       -- transaction, sinpe, qr_payment, crypto, card
    tx_id VARCHAR(100) NOT NULL,
    amount BIGINT NOT NULL,             -- centimos
    risk_score INTEGER NOT NULL,        -- 0-100
    risk_level VARCHAR(20) NOT NULL,    -- low, medium, high, critical
    factors TEXT NOT NULL,              -- JSON array of risk factors
    action VARCHAR(20) NOT NULL,        -- allow, review, block

    reviewed_by VARCHAR(100),
    reviewed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fraud_assessments_user ON fraud_assessments(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fraud_assessments_score ON fraud_assessments(risk_score DESC);

-- ============================================================================
-- 3. FRAUD ALERTS (flagged for human review)
-- ============================================================================

CREATE TABLE IF NOT EXISTS fraud_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    assessment_id UUID NOT NULL REFERENCES fraud_assessments(id),
    type VARCHAR(30) NOT NULL,         -- suspicious_tx, velocity_breach, amount_anomaly, device_change
    severity VARCHAR(20) NOT NULL,     -- low, medium, high, critical
    message TEXT NOT NULL,
    status VARCHAR(20) DEFAULT 'open', -- open, investigating, resolved, false_positive

    resolved_by VARCHAR(100),
    resolved_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fraud_alerts_status ON fraud_alerts(status, severity);
CREATE INDEX IF NOT EXISTS idx_fraud_alerts_user ON fraud_alerts(user_id, created_at DESC);

-- ============================================================================
-- 4. USER RISK PROFILES (aggregated risk data per user)
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_risk_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,

    overall_risk_score INTEGER DEFAULT 0,
    total_transactions BIGINT DEFAULT 0,
    total_flagged BIGINT DEFAULT 0,
    avg_tx_amount BIGINT DEFAULT 0,     -- centimos
    max_tx_amount BIGINT DEFAULT 0,     -- centimos
    last_activity_at TIMESTAMP DEFAULT NOW(),
    account_age_days INTEGER DEFAULT 0,
    is_restricted BOOLEAN DEFAULT FALSE,

    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
