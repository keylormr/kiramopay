-- Bajada de 072_envio_de_cripto.sql
--
-- Se pierde a quien se le envio cada 'send' y de quien vino cada 'receive', la
-- llave con que se envio, y el registro de las comisiones que KiramoPay cobro
-- en cripto. Los envios ya hechos NO se deshacen: los saldos quedan como
-- quedaron, pero la comision cobrada deja de tener respaldo y la cuadratura por
-- activo ya no cierra. Antes de bajar esto, exportar crypto_platform_fees.

DROP TABLE IF EXISTS crypto_platform_fees;

DROP INDEX IF EXISTS idx_crypto_tx_contraparte;
DROP INDEX IF EXISTS uq_crypto_tx_llave;
ALTER TABLE crypto_transactions
    DROP COLUMN IF EXISTS idempotency_key,
    DROP COLUMN IF EXISTS counterparty_name,
    DROP COLUMN IF EXISTS counterparty_user_id;
