-- Migration 021: Historized FX rates with temporal validity, link cross-border
-- transfers to specific rate snapshot for forensic-grade reconstruction.

BEGIN;

-- =========================================================================
-- 1. Add temporal columns. We keep UNIQUE(from,to) gone; instead we add a
--    partial unique on the *active* row per pair (effective_to IS NULL).
-- =========================================================================
ALTER TABLE exchange_rates
    ADD COLUMN IF NOT EXISTS effective_from TIMESTAMP NOT NULL DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS effective_to   TIMESTAMP,
    ADD COLUMN IF NOT EXISTS spread_bps     INTEGER NOT NULL DEFAULT 0,  -- our spread atop mid-rate
    ADD COLUMN IF NOT EXISTS source_rate    NUMERIC(20, 10);            -- raw rate before spread

ALTER TABLE exchange_rates
    DROP CONSTRAINT IF EXISTS exchange_rates_from_currency_to_currency_key;

-- Only one *current* (open-ended) row per pair:
CREATE UNIQUE INDEX IF NOT EXISTS uq_fx_active_pair
    ON exchange_rates (from_currency, to_currency)
    WHERE effective_to IS NULL;

CREATE INDEX IF NOT EXISTS idx_fx_pair_time
    ON exchange_rates (from_currency, to_currency, effective_from DESC);

ALTER TABLE exchange_rates
    ADD CONSTRAINT chk_fx_period_valid CHECK (
        effective_to IS NULL OR effective_to > effective_from
    ) NOT VALID;
ALTER TABLE exchange_rates VALIDATE CONSTRAINT chk_fx_period_valid;

ALTER TABLE exchange_rates
    ADD CONSTRAINT chk_fx_spread_range CHECK (spread_bps BETWEEN 0 AND 1000) NOT VALID;
ALTER TABLE exchange_rates VALIDATE CONSTRAINT chk_fx_spread_range;

-- =========================================================================
-- 2. cross_border_transfers references the rate row used.
-- =========================================================================
ALTER TABLE cross_border_transfers
    ADD COLUMN IF NOT EXISTS exchange_rate_id UUID REFERENCES exchange_rates(id),
    ADD COLUMN IF NOT EXISTS spread_bps_at_time INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_xbt_rate ON cross_border_transfers (exchange_rate_id);

-- =========================================================================
-- 3. Trigger: closing the active rate when a new one is inserted.
-- =========================================================================
CREATE OR REPLACE FUNCTION fn_fx_close_active()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.effective_to IS NULL THEN
        UPDATE exchange_rates
            SET effective_to = NEW.effective_from
        WHERE from_currency = NEW.from_currency
          AND to_currency   = NEW.to_currency
          AND effective_to IS NULL
          AND id <> NEW.id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_fx_close_active ON exchange_rates;
CREATE TRIGGER trg_fx_close_active
    BEFORE INSERT ON exchange_rates
    FOR EACH ROW EXECUTE FUNCTION fn_fx_close_active();

-- =========================================================================
-- 4. View: current rates (convenience).
-- =========================================================================
CREATE OR REPLACE VIEW current_exchange_rates AS
    SELECT id, from_currency, to_currency, rate, spread_bps, source_rate,
           source, effective_from
    FROM exchange_rates
    WHERE effective_to IS NULL;

-- =========================================================================
-- 5. Function: resolve rate at a point in time.
-- =========================================================================
CREATE OR REPLACE FUNCTION fn_fx_rate_at(
    p_from VARCHAR, p_to VARCHAR, p_at TIMESTAMP
) RETURNS NUMERIC(20, 10) AS $$
    SELECT rate FROM exchange_rates
    WHERE from_currency = p_from
      AND to_currency = p_to
      AND effective_from <= p_at
      AND (effective_to IS NULL OR effective_to > p_at)
    ORDER BY effective_from DESC
    LIMIT 1
$$ LANGUAGE sql STABLE;

COMMIT;
