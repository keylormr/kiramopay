-- fn_fx_rate_at recibe el instante con zona.
--
-- La 021 la creo con p_at TIMESTAMP, cuando effective_from y effective_to
-- tambien eran sin zona y la comparacion no dependia de ninguna zona. La 075
-- paso esas dos columnas a TIMESTAMPTZ y la funcion quedo comparando un
-- instante con una hora sin zona: Postgres convierte p_at con la zona de la
-- sesion, y fuera de UTC la funcion devuelve la tasa de otra hora.
--
-- Cambia el tipo de un parametro, que CREATE OR REPLACE no puede hacer: se
-- borra la de la 021 y se crea la nueva con el mismo cuerpo. Nada en la
-- aplicacion la llama, y no tiene permisos propios.

DROP FUNCTION IF EXISTS fn_fx_rate_at(VARCHAR, VARCHAR, TIMESTAMP);

CREATE FUNCTION fn_fx_rate_at(
    p_from VARCHAR, p_to VARCHAR, p_at TIMESTAMPTZ
) RETURNS NUMERIC(20, 10) AS $$
    SELECT rate FROM exchange_rates
    WHERE from_currency = p_from
      AND to_currency = p_to
      AND effective_from <= p_at
      AND (effective_to IS NULL OR effective_to > p_at)
    ORDER BY effective_from DESC
    LIMIT 1
$$ LANGUAGE sql STABLE;
