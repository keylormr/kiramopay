BEGIN;

DROP FUNCTION IF EXISTS fn_fx_rate_at(VARCHAR, VARCHAR, TIMESTAMP);
DROP VIEW IF EXISTS current_exchange_rates;
DROP TRIGGER IF EXISTS trg_fx_close_active ON exchange_rates;
DROP FUNCTION IF EXISTS fn_fx_close_active();

ALTER TABLE cross_border_transfers
    DROP COLUMN IF EXISTS exchange_rate_id,
    DROP COLUMN IF EXISTS spread_bps_at_time;

DROP INDEX IF EXISTS uq_fx_active_pair;
DROP INDEX IF EXISTS idx_fx_pair_time;

ALTER TABLE exchange_rates
    DROP CONSTRAINT IF EXISTS chk_fx_period_valid,
    DROP CONSTRAINT IF EXISTS chk_fx_spread_range,
    DROP COLUMN IF EXISTS effective_from,
    DROP COLUMN IF EXISTS effective_to,
    DROP COLUMN IF EXISTS spread_bps,
    DROP COLUMN IF EXISTS source_rate;

ALTER TABLE exchange_rates
    ADD CONSTRAINT exchange_rates_from_currency_to_currency_key UNIQUE (from_currency, to_currency);

COMMIT;
