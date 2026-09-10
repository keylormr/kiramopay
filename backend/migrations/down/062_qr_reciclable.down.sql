-- Bajada de 062_qr_reciclable.sql
--
-- LO QUE ESTA BAJADA NO REVIERTE, y hay que saberlo antes de usarla:
--
--   * Los codigos de comercio viejos quedaron retirados en el paso 2. Al
--     desaparecer la columna `status` vuelven a ser pagables con el binario
--     viejo, o sea que la foto de un QR de julio vuelve a cobrar.
--   * Los cobros creados durante la ventana se pierden con la tabla.
--   * Los codigos permanentes del backfill se quedan: con el binario viejo son
--     merchant_dynamic de monto 0, es decir codigos de comercio validos.
--
-- Por eso el rollback real, si algo sale mal despues de horas de operacion, es
-- desplegar hacia adelante con un arreglo, no bajar esta migracion.

DROP INDEX IF EXISTS ux_qr_payments_txid;
ALTER TABLE qr_payments DROP COLUMN IF EXISTS charge_id;

DROP TABLE IF EXISTS qr_charges;

DROP INDEX IF EXISTS ux_qr_code_persona;
DROP INDEX IF EXISTS ux_qr_code_comercio;
ALTER TABLE qr_payment_codes DROP CONSTRAINT IF EXISTS chk_qr_code_activo_sin_monto;
ALTER TABLE qr_payment_codes DROP CONSTRAINT IF EXISTS chk_qr_code_status;
ALTER TABLE qr_payment_codes DROP COLUMN IF EXISTS revoked_at;
ALTER TABLE qr_payment_codes DROP COLUMN IF EXISTS status;

ALTER TABLE journal_postings ALTER COLUMN idempotency_key TYPE VARCHAR(80);
