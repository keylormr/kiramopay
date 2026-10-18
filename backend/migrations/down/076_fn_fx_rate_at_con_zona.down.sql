-- Bajada de 076_fn_fx_rate_at_con_zona.sql
--
-- fn_fx_rate_at vuelve a recibir el instante sin zona, como la creo la 021. Con
-- la 075 aplicada, su resultado depende otra vez de la zona de la sesion.

DROP FUNCTION IF EXISTS fn_fx_rate_at(VARCHAR, VARCHAR, TIMESTAMPTZ);

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
