-- Bajada de 080_uif_mes_calendario.sql
--
-- Se pierde el registro de cada movimiento evaluado (su equivalente en dolares,
-- la tasa, su fecha y su fuente), la venta de referencia de cada dia y la marca
-- de los meses cerrados. Son rastro de cumplimiento: antes de bajar esto,
-- exportar uif_movimientos, tipo_de_cambio_diario y uif_cierres.
--
-- OJO: si ya hay casos 'multiples_mes', 'cierre_mes' o 'estructuracion_30d', la
-- restriccion vieja no los admite y esta vuelta atras falla. Hay que
-- resolverlos antes de revertir, sabiendo que son rastro de cumplimiento.

DROP TABLE IF EXISTS uif_cierres;
DROP INDEX IF EXISTS uq_uif_reports_cierre;

ALTER TABLE uif_reports
    DROP COLUMN IF EXISTS entradas_mes_usd_minor,
    DROP COLUMN IF EXISTS salidas_mes_usd_minor,
    DROP COLUMN IF EXISTS mes;

ALTER TABLE uif_reports DROP CONSTRAINT IF EXISTS chk_uif_type;
ALTER TABLE uif_reports
    ADD CONSTRAINT chk_uif_type
    CHECK (report_type IN ('single_threshold', 'structuring', 'manual', 'acumulado_30d'));

DROP TABLE IF EXISTS uif_movimientos;
DROP TABLE IF EXISTS tipo_de_cambio_diario;
