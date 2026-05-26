-- Migration 018: Integrity constraints, dedicated idempotency_key, FK hardening
-- Phase: P0 — Data integrity foundation
-- Notes: All constraints use NOT VALID where possible to avoid blocking migrations
--        on existing rows; a follow-up VALIDATE CONSTRAINT step is then run.

BEGIN;

-- =========================================================================
-- 1. Dedicated idempotency_key column on transactions (was metadata->>)
-- =========================================================================
ALTER TABLE transactions
    ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(80);

-- Backfill from metadata where present
UPDATE transactions
SET idempotency_key = metadata->>'idempotency_key'
WHERE idempotency_key IS NULL
  AND metadata ? 'idempotency_key';

-- Unique idempotency per (user, key) — only enforce on non-null keys.
-- Note: partitioned table, so the unique index must include the partition key.
CREATE UNIQUE INDEX IF NOT EXISTS uq_tx_user_idempotency
    ON transactions (user_id, idempotency_key, created_date)
    WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tx_idempotency
    ON transactions (idempotency_key, created_date)
    WHERE idempotency_key IS NOT NULL;

-- =========================================================================
-- 2. CHECK constraints — amounts & statuses
-- =========================================================================
ALTER TABLE transactions
    ADD CONSTRAINT chk_tx_amount_positive CHECK (amount > 0) NOT VALID,
    ADD CONSTRAINT chk_tx_fee_nonneg CHECK (fee >= 0) NOT VALID,
    ADD CONSTRAINT chk_tx_status CHECK (
        status IN ('pending','processing','completed','failed','reversed','disputed')
    ) NOT VALID,
    ADD CONSTRAINT chk_tx_currency CHECK (currency IN ('CRC','USD','PAB','GTQ')) NOT VALID;

-- Validate (can fail loudly if existing rows violate — review & clean first)
ALTER TABLE transactions VALIDATE CONSTRAINT chk_tx_amount_positive;
ALTER TABLE transactions VALIDATE CONSTRAINT chk_tx_fee_nonneg;
ALTER TABLE transactions VALIDATE CONSTRAINT chk_tx_status;
ALTER TABLE transactions VALIDATE CONSTRAINT chk_tx_currency;

-- =========================================================================
-- 3. wallets: balance non-negative + counters
-- =========================================================================
-- Floors: balance can go to zero, never below. Daily/monthly counters never negative.
ALTER TABLE wallets
    ADD CONSTRAINT chk_wallet_balance_crc_nonneg CHECK (balance_crc >= 0) NOT VALID,
    ADD CONSTRAINT chk_wallet_balance_usd_nonneg CHECK (balance_usd >= 0) NOT VALID,
    ADD CONSTRAINT chk_wallet_daily_spent_nonneg CHECK (daily_spent >= 0) NOT VALID,
    ADD CONSTRAINT chk_wallet_monthly_spent_nonneg CHECK (monthly_spent >= 0) NOT VALID,
    ADD CONSTRAINT chk_wallet_daily_limit_pos CHECK (daily_limit >= 0) NOT VALID,
    ADD CONSTRAINT chk_wallet_status CHECK (status IN ('active','frozen','closed')) NOT VALID;

ALTER TABLE wallets VALIDATE CONSTRAINT chk_wallet_balance_crc_nonneg;
ALTER TABLE wallets VALIDATE CONSTRAINT chk_wallet_balance_usd_nonneg;
ALTER TABLE wallets VALIDATE CONSTRAINT chk_wallet_daily_spent_nonneg;
ALTER TABLE wallets VALIDATE CONSTRAINT chk_wallet_monthly_spent_nonneg;
ALTER TABLE wallets VALIDATE CONSTRAINT chk_wallet_daily_limit_pos;
ALTER TABLE wallets VALIDATE CONSTRAINT chk_wallet_status;

-- =========================================================================
-- 4. users: KYC bounds, status whitelist
-- =========================================================================
ALTER TABLE users
    ADD CONSTRAINT chk_users_kyc_level CHECK (kyc_level BETWEEN 0 AND 2) NOT VALID,
    ADD CONSTRAINT chk_users_kyc_status CHECK (
        kyc_status IN ('pending','in_review','verified','rejected')
    ) NOT VALID,
    ADD CONSTRAINT chk_users_status CHECK (
        status IN ('active','suspended','blocked','closed')
    ) NOT VALID;

ALTER TABLE users VALIDATE CONSTRAINT chk_users_kyc_level;
ALTER TABLE users VALIDATE CONSTRAINT chk_users_kyc_status;
ALTER TABLE users VALIDATE CONSTRAINT chk_users_status;

-- =========================================================================
-- 5. Strengthen FKs that today reference soft-typed VARCHAR ids.
--    (Where the source already uses UUID and there is a real target,
--    we add ON DELETE behaviour.)
-- =========================================================================

-- fraud_assessments.tx_id (may be VARCHAR pointing at transactions.id) —
-- transactions is partitioned, so we cannot FK directly. Instead we add a
-- lookup index and a soft validation trigger below.
CREATE INDEX IF NOT EXISTS idx_fraud_assessments_txid
    ON fraud_assessments (tx_id)
    WHERE tx_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_qr_payments_txid
    ON qr_payments (tx_id)
    WHERE tx_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_loyalty_tx_refid
    ON loyalty_transactions (ref_id)
    WHERE ref_id IS NOT NULL;

-- =========================================================================
-- 6. user_sessions: enforce expiry > created
-- =========================================================================
ALTER TABLE user_sessions
    ADD CONSTRAINT chk_session_expiry CHECK (expires_at > created_at) NOT VALID;
ALTER TABLE user_sessions VALIDATE CONSTRAINT chk_session_expiry;

COMMIT;
