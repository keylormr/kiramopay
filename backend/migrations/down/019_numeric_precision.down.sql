-- Rollback for 019
BEGIN;

ALTER TABLE crypto_assets
    DROP CONSTRAINT IF EXISTS chk_crypto_balance_nonneg,
    ALTER COLUMN balance  TYPE DOUBLE PRECISION USING balance::double precision,
    ALTER COLUMN avg_cost TYPE DOUBLE PRECISION USING avg_cost::double precision;

ALTER TABLE crypto_transactions
    DROP CONSTRAINT IF EXISTS chk_crypto_tx_amount_positive,
    DROP CONSTRAINT IF EXISTS chk_crypto_tx_type,
    ALTER COLUMN amount TYPE DOUBLE PRECISION USING amount::double precision,
    ALTER COLUMN price  TYPE DOUBLE PRECISION USING price::double precision,
    ALTER COLUMN total  TYPE DOUBLE PRECISION USING total::double precision,
    ALTER COLUMN fee    TYPE DOUBLE PRECISION USING fee::double precision;

ALTER TABLE crypto_staking
    DROP CONSTRAINT IF EXISTS chk_staking_amount_positive,
    DROP CONSTRAINT IF EXISTS chk_staking_apy_range,
    ALTER COLUMN amount  TYPE DOUBLE PRECISION USING amount::double precision,
    ALTER COLUMN apy     TYPE DOUBLE PRECISION USING apy::double precision,
    ALTER COLUMN earned  TYPE DOUBLE PRECISION USING earned::double precision;

ALTER TABLE crypto_price_alerts
    DROP CONSTRAINT IF EXISTS chk_alert_target_positive,
    DROP CONSTRAINT IF EXISTS chk_alert_direction,
    ALTER COLUMN target_price TYPE DOUBLE PRECISION USING target_price::double precision;

ALTER TABLE cashback_rules
    DROP CONSTRAINT IF EXISTS chk_cashback_pct_range,
    DROP CONSTRAINT IF EXISTS chk_cashback_max_nonneg,
    ALTER COLUMN percentage TYPE DOUBLE PRECISION USING percentage::double precision;

ALTER TABLE exchange_rates
    DROP CONSTRAINT IF EXISTS chk_fx_rate_positive,
    ALTER COLUMN rate TYPE DOUBLE PRECISION USING rate::double precision;

ALTER TABLE cross_border_transfers
    DROP CONSTRAINT IF EXISTS chk_xbt_amounts_positive,
    DROP CONSTRAINT IF EXISTS chk_xbt_status,
    ALTER COLUMN exchange_rate TYPE DOUBLE PRECISION USING exchange_rate::double precision;

COMMIT;
