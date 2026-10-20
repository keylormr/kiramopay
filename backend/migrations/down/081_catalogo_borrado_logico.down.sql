-- Bajada de 081_catalogo_borrado_logico.sql
--
-- Se pierde cuando se saco cada producto; quien lo saco sigue en audit_logs.
-- Las filas no se tocan: nunca se borraron. Un producto sacado queda inactivo,
-- y el codigo anterior a la 081 lo vuelve a mostrar en la gestion del catalogo
-- como desactivado (al cobrar no aparece: esa pantalla solo trae los activos).

ALTER TABLE merchant_catalog_items DROP CONSTRAINT IF EXISTS chk_catalog_sacado_inactivo;
ALTER TABLE merchant_catalog_items DROP COLUMN IF EXISTS deleted_at;
