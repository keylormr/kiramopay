-- 017_recurring_payments.sql — Recurring payment schedules per user

CREATE TABLE IF NOT EXISTS recurring_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    label VARCHAR(200) NOT NULL,
    type VARCHAR(20) NOT NULL,
    amount BIGINT NOT NULL,
    currency VARCHAR(3) DEFAULT 'CRC',
    frequency VARCHAR(20) NOT NULL,
    next_date DATE NOT NULL,
    last_paid_date DATE,
    recipient_phone VARCHAR(15),
    recipient_name VARCHAR(100),
    service_provider_id VARCHAR(20),
    client_id VARCHAR(50),
    enabled BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recurring_user ON recurring_payments(user_id);
