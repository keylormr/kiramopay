-- Rollback for 018
BEGIN;

DROP INDEX IF EXISTS uq_tx_user_idempotency;
DROP INDEX IF EXISTS idx_tx_idempotency;
ALTER TABLE transactions DROP COLUMN IF EXISTS idempotency_key;

ALTER TABLE transactions
    DROP CONSTRAINT IF EXISTS chk_tx_amount_positive,
    DROP CONSTRAINT IF EXISTS chk_tx_fee_nonneg,
    DROP CONSTRAINT IF EXISTS chk_tx_status,
    DROP CONSTRAINT IF EXISTS chk_tx_currency;

ALTER TABLE wallets
    DROP CONSTRAINT IF EXISTS chk_wallet_balance_crc_nonneg,
    DROP CONSTRAINT IF EXISTS chk_wallet_balance_usd_nonneg,
    DROP CONSTRAINT IF EXISTS chk_wallet_daily_spent_nonneg,
    DROP CONSTRAINT IF EXISTS chk_wallet_monthly_spent_nonneg,
    DROP CONSTRAINT IF EXISTS chk_wallet_daily_limit_pos,
    DROP CONSTRAINT IF EXISTS chk_wallet_status;

ALTER TABLE users
    DROP CONSTRAINT IF EXISTS chk_users_kyc_level,
    DROP CONSTRAINT IF EXISTS chk_users_kyc_status,
    DROP CONSTRAINT IF EXISTS chk_users_status;

DROP INDEX IF EXISTS idx_fraud_assessments_txid;
DROP INDEX IF EXISTS idx_qr_payments_txid;
DROP INDEX IF EXISTS idx_loyalty_tx_refid;

ALTER TABLE user_sessions DROP CONSTRAINT IF EXISTS chk_session_expiry;

COMMIT;
