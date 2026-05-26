-- 016_budgets.sql — Budget tracking per user

CREATE TABLE IF NOT EXISTS budgets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    label VARCHAR(100) NOT NULL,
    amount_limit BIGINT NOT NULL,
    amount_spent BIGINT DEFAULT 0,
    currency VARCHAR(3) DEFAULT 'CRC',
    icon VARCHAR(50),
    color VARCHAR(20),
    period VARCHAR(20) DEFAULT 'monthly',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_budgets_user ON budgets(user_id);
