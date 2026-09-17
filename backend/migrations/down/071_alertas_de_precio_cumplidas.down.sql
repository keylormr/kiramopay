-- Bajada de 071_alertas_de_precio_cumplidas.sql
--
-- Se pierde cuando y a que precio se cumplio cada alerta, y cuando se quito:
-- las cumplidas y las quitadas quedan como filas inactivas sin mas datos, que
-- es como las veia la aplicacion antes de la 071. Ninguna vuelve a activarse.

DROP INDEX IF EXISTS idx_crypto_alerts_pendientes;
ALTER TABLE crypto_price_alerts DROP CONSTRAINT IF EXISTS chk_alert_cumplida;
ALTER TABLE crypto_price_alerts
    DROP COLUMN IF EXISTS borrada_at,
    DROP COLUMN IF EXISTS precio_cumplida,
    DROP COLUMN IF EXISTS cumplida_at;
