-- Migration 043: seed baseline FX rates so the public /api/v1/exchange-rates
-- endpoint serves a single authoritative rate per pair.
--
-- Why this is needed: SeedCountries() (which seeds these rates) was never wired
-- into boot, so the exchange_rates table shipped EMPTY in production — the
-- endpoint returned {"success":true,"data":null}. With no server rate, the
-- frontend fell back to three different hardcoded constants (515 / 520 / 526),
-- inflating the "USD Total" and disagreeing across views. This seeds the active
-- row per pair; the frontend now reads exactly this value.
--
-- Post-021 note: the table is historized (one *active* row per pair, i.e.
-- effective_to IS NULL, enforced by the partial unique index uq_fx_active_pair).
-- The old SeedCountries INSERT used `ON CONFLICT (from_currency, to_currency)`,
-- which no longer matches any constraint after 021 dropped the plain unique key.
-- We instead insert only when no active row exists for the pair, which is fully
-- idempotent and cooperates with the trg_fx_close_active trigger.
--
-- Rates are approximate/manual (source='manual'). Making them live (fetched from
-- a provider) is tracked separately; this migration only removes the empty-table
-- footgun and gives every surface one consistent number.

INSERT INTO exchange_rates (from_currency, to_currency, rate, source)
SELECT v.f, v.t, v.r, 'manual'
FROM (VALUES
    ('USD', 'CRC', 515.0),
    ('CRC', 'USD', 0.00194),
    ('USD', 'PAB', 1.0),      -- PAB pegged 1:1 to USD
    ('PAB', 'USD', 1.0),
    ('CRC', 'PAB', 0.00194),
    ('PAB', 'CRC', 515.0),
    ('USD', 'GTQ', 7.75),
    ('GTQ', 'USD', 0.129),
    ('CRC', 'GTQ', 0.0150),
    ('GTQ', 'CRC', 66.67),
    ('PAB', 'GTQ', 7.75),
    ('GTQ', 'PAB', 0.129)
) AS v(f, t, r)
WHERE NOT EXISTS (
    SELECT 1 FROM exchange_rates e
    WHERE e.from_currency = v.f
      AND e.to_currency = v.t
      AND e.effective_to IS NULL
);
