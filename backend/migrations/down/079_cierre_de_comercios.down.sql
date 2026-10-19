-- Bajada de 079_cierre_de_comercios.sql
--
-- Se pierde quien cerro cada comercio, cuando y por que. Las filas no se
-- tocan: nunca se borraron. Un comercio que estaba cerrado queda con
-- active = FALSE, y el codigo anterior a la 079 lo vuelve a mostrar en la
-- lista de su dueno (esa lista no filtraba).
--
-- closed_at tambien lo agrega la 077 (eliminacion de cuenta). Si la 077 esta
-- aplicada, su CHECK depende de la columna: se deja, para no deshacer una
-- migracion que esta bajada no es.

ALTER TABLE qr_merchants DROP CONSTRAINT IF EXISTS chk_qr_merchants_cierre;
ALTER TABLE qr_merchants DROP COLUMN IF EXISTS closure_reason;
ALTER TABLE qr_merchants DROP COLUMN IF EXISTS closed_by;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'qr_merchants'::regclass
                      AND conname = 'chk_qr_merchants_cerrado_inactivo') THEN
        ALTER TABLE qr_merchants DROP COLUMN IF EXISTS closed_at;
    END IF;
END $$;
