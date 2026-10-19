-- 081_catalogo_borrado_logico.sql
--
-- Sacar un producto del catalogo, sin borrarlo.
--
-- Hasta hoy DELETE /api/v1/qr/merchants/{id}/catalog/{itemID} borraba la fila
-- de merchant_catalog_items. Regla permanente del dueno: todo borrado es
-- logico; quitar acceso no es borrar registros. Desde aca sacar un producto
-- marca la fila con deleted_at y la deja inactiva, y quien lo saco queda en
-- audit_logs (merchant_catalog_item_removed) en la misma transaccion.
--
-- Quien lo saco va al rastro y no a la fila a proposito: una columna con
-- clave foranea a users haria de esta tabla una que apunta a una persona, y
-- la eliminacion de cuenta (#279, migracion 077) la trata como una que no lo
-- hace: cuelga del comercio.
--
-- Un producto sacado no se lista (ni en la gestion ni al cobrar), no se edita
-- y no vuelve: para venderlo otra vez se crea de nuevo. Las ventas no apuntan
-- al producto (guardan el total y una nota, 046), asi que ninguna cambia.
--
-- Con zona, como toda fecha desde la 034.

ALTER TABLE merchant_catalog_items ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Un producto sacado no puede quedar activo: ni la gestion ni otra ruta lo
-- reactivan por un descuido. `active` es NOT NULL desde la 046.
--
-- NOT VALID y despues VALIDATE, como la 079: el ALTER que agrega el CHECK solo
-- toma la tabla un instante, y la validacion la recorre sin frenar escrituras.
ALTER TABLE merchant_catalog_items DROP CONSTRAINT IF EXISTS chk_catalog_sacado_inactivo;
ALTER TABLE merchant_catalog_items ADD CONSTRAINT chk_catalog_sacado_inactivo
    CHECK (deleted_at IS NULL OR active IS FALSE) NOT VALID;
ALTER TABLE merchant_catalog_items VALIDATE CONSTRAINT chk_catalog_sacado_inactivo;

COMMENT ON COLUMN merchant_catalog_items.deleted_at IS
    'Cuando se saco el producto del catalogo (081). Sacado no se lista, no se edita ni se reactiva; la fila no se borra nunca. Quien lo saco esta en audit_logs.';
