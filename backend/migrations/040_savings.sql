-- Migration 040: savings goals + a savings holding ledger account.
-- Phase: I — savings
--
-- Savings turns from a client-only simulation into a real feature. A deposit
-- moves money from the user's wallet into SYSTEM:SAVINGS (a credit-normal holding
-- account, like SYSTEM:ESCROW), recoverable via withdraw. The per-goal saved
-- amount is tracked in savings_goals. All money movement is a balanced
-- double-entry ledger posting, so balances and reconciliation stay correct.

-- Allow the 'savings' ledger account type.
ALTER TABLE ledger_accounts DROP CONSTRAINT IF EXISTS chk_ledger_account_type;
ALTER TABLE ledger_accounts ADD CONSTRAINT chk_ledger_account_type CHECK (
    type IN ('user_wallet','system_fee','suspense','external','reserve','escrow','savings')
);

-- Seed the savings holding accounts (idempotent).
INSERT INTO ledger_accounts (code, type, currency, normal_balance, metadata) VALUES
    ('SYSTEM:SAVINGS:CRC', 'savings', 'CRC', 'credit', '{"desc":"User savings held CRC"}'),
    ('SYSTEM:SAVINGS:USD', 'savings', 'USD', 'credit', '{"desc":"User savings held USD"}')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS savings_goals (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name         VARCHAR(120) NOT NULL,
    target_minor BIGINT NOT NULL CHECK (target_minor >= 0),
    saved_minor  BIGINT NOT NULL DEFAULT 0 CHECK (saved_minor >= 0),
    currency     VARCHAR(3) NOT NULL DEFAULT 'CRC',
    icon         VARCHAR(40) NOT NULL DEFAULT 'piggy-bank',
    color        VARCHAR(20) NOT NULL DEFAULT '',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_savings_goals_user ON savings_goals(user_id);
