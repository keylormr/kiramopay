-- Migration 019: Replace DOUBLE PRECISION with NUMERIC for monetary fields.
-- Phase: P1 — Precision correctness
-- Reason: BTC needs 8 decimals; cashback percentage needs 4. Floats lose cents.

BEGIN;

-- =========================================================================
-- crypto_assets — balance up to 38 digits with 18 decimals
-- =========================================================================
ALTER TABLE crypto_assets
    ALTER COLUMN balance TYPE NUMERIC(38, 18) USING balance::numeric(38, 18),
    ALTER COLUMN avg_cost TYPE NUMERIC(38, 18) USING avg_cost::numeric(38, 18),
    ALTER COLUMN balance SET DEFAULT 0,
    ALTER COLUMN avg_cost SET DEFAULT 0;

ALTER TABLE crypto_assets
    ADD CONSTRAINT chk_crypto_balance_nonneg CHECK (balance >= 0) NOT VALID;
ALTER TABLE crypto_assets VALIDATE CONSTRAINT chk_crypto_balance_nonneg;

-- =========================================================================
-- crypto_transactions
-- =========================================================================
ALTER TABLE crypto_transactions
    ALTER COLUMN amount TYPE NUMERIC(38, 18) USING amount::numeric(38, 18),
    ALTER COLUMN price  TYPE NUMERIC(38, 18) USING price::numeric(38, 18),
    ALTER COLUMN total  TYPE NUMERIC(38, 18) USING total::numeric(38, 18),
    ALTER COLUMN fee    TYPE NUMERIC(38, 18) USING fee::numeric(38, 18),
    ALTER COLUMN fee    SET DEFAULT 0;

ALTER TABLE crypto_transactions
    ADD CONSTRAINT chk_crypto_tx_amount_positive CHECK (amount > 0) NOT VALID,
    ADD CONSTRAINT chk_crypto_tx_type CHECK (
        type IN ('buy','sell','convert','send','receive','stake','unstake','reward')
    ) NOT VALID;
ALTER TABLE crypto_transactions VALIDATE CONSTRAINT chk_crypto_tx_amount_positive;
ALTER TABLE crypto_transactions VALIDATE CONSTRAINT chk_crypto_tx_type;

-- =========================================================================
-- crypto_staking
-- =========================================================================
ALTER TABLE crypto_staking
    ALTER COLUMN amount  TYPE NUMERIC(38, 18) USING amount::numeric(38, 18),
    ALTER COLUMN apy     TYPE NUMERIC(8, 4)   USING apy::numeric(8, 4),
    ALTER COLUMN earned  TYPE NUMERIC(38, 18) USING earned::numeric(38, 18),
    ALTER COLUMN earned  SET DEFAULT 0;

ALTER TABLE crypto_staking
    ADD CONSTRAINT chk_staking_amount_positive CHECK (amount > 0) NOT VALID,
    ADD CONSTRAINT chk_staking_apy_range CHECK (apy >= 0 AND apy <= 100) NOT VALID;
ALTER TABLE crypto_staking VALIDATE CONSTRAINT chk_staking_amount_positive;
ALTER TABLE crypto_staking VALIDATE CONSTRAINT chk_staking_apy_range;

-- =========================================================================
-- crypto_price_alerts
-- =========================================================================
ALTER TABLE crypto_price_alerts
    ALTER COLUMN target_price TYPE NUMERIC(38, 18) USING target_price::numeric(38, 18);

ALTER TABLE crypto_price_alerts
    ADD CONSTRAINT chk_alert_target_positive CHECK (target_price > 0) NOT VALID,
    ADD CONSTRAINT chk_alert_direction CHECK (direction IN ('above','below')) NOT VALID;
ALTER TABLE crypto_price_alerts VALIDATE CONSTRAINT chk_alert_target_positive;
ALTER TABLE crypto_price_alerts VALIDATE CONSTRAINT chk_alert_direction;

-- =========================================================================
-- cashback_rules — percentage stored as NUMERIC(6,4) in the 0..100 scale
-- (e.g. 2.5000 = 2.50%). Using the 0..100 scale matches how callers already
-- write the value; the 0..1 alternative would force a touch on every site.
-- =========================================================================
ALTER TABLE cashback_rules
    ALTER COLUMN percentage TYPE NUMERIC(6, 4) USING percentage::numeric(6, 4);

ALTER TABLE cashback_rules
    ADD CONSTRAINT chk_cashback_pct_range CHECK (percentage >= 0 AND percentage <= 100) NOT VALID,
    ADD CONSTRAINT chk_cashback_max_nonneg CHECK (max_points_per_tx >= 0) NOT VALID;
ALTER TABLE cashback_rules VALIDATE CONSTRAINT chk_cashback_pct_range;
ALTER TABLE cashback_rules VALIDATE CONSTRAINT chk_cashback_max_nonneg;

-- =========================================================================
-- exchange_rates — high-precision NUMERIC; keep as historical (see 021)
-- =========================================================================
ALTER TABLE exchange_rates
    ALTER COLUMN rate TYPE NUMERIC(20, 10) USING rate::numeric(20, 10);

ALTER TABLE exchange_rates
    ADD CONSTRAINT chk_fx_rate_positive CHECK (rate > 0) NOT VALID;
ALTER TABLE exchange_rates VALIDATE CONSTRAINT chk_fx_rate_positive;

-- =========================================================================
-- cross_border_transfers
-- =========================================================================
ALTER TABLE cross_border_transfers
    ALTER COLUMN exchange_rate TYPE NUMERIC(20, 10) USING exchange_rate::numeric(20, 10);

ALTER TABLE cross_border_transfers
    ADD CONSTRAINT chk_xbt_amounts_positive CHECK (
        from_amount > 0 AND to_amount > 0 AND exchange_rate > 0 AND fee >= 0
    ) NOT VALID,
    ADD CONSTRAINT chk_xbt_status CHECK (
        status IN ('pending','processing','completed','failed','cancelled','reversed')
    ) NOT VALID;
ALTER TABLE cross_border_transfers VALIDATE CONSTRAINT chk_xbt_amounts_positive;
ALTER TABLE cross_border_transfers VALIDATE CONSTRAINT chk_xbt_status;

COMMIT;
