-- Bajada de 077_eliminacion_de_cuenta.sql
--
-- Quita las columnas y las tablas. NO deshace lo que el proceso ya hizo: lo que
-- se suprimio el dia 30 no vuelve, y la identidad que estaba en
-- closed_account_records se pierde con la tabla. Por eso, en una base con
-- cuentas ya cerradas, esta bajada solo se corre despues de respaldar esa tabla.
--
-- Una cuenta que este a mitad del plazo queda con status 'pending_deletion' y
-- sin fechas: el binario viejo la trata como bloqueada (login con
-- ACCOUNT_BLOCKED) hasta que alguien decida que hacer con ella. Los CHECK de la
-- 018 y de la 052 vuelven como NOT VALID por la misma razon: no deben hacer
-- fallar la bajada ni obligar a tocar esas filas.
--
-- Ojo con el libro: al quitar ledger_accounts.closed_at se REABREN todas las
-- cuentas cerradas, las de las personas en plazo y las de las ya eliminadas. El
-- binario viejo no sabe que estaban cerradas y les acredita lo que llegue. Antes
-- de bajar, revisar que nadie pueda mandarles dinero (sus telefonos y codigos QR
-- ya no deberian resolver) o dejarlas en un estado que el binario viejo rechace.

DROP TABLE IF EXISTS account_deletion_requests;
DROP TABLE IF EXISTS closed_account_records;

ALTER TABLE qr_merchants DROP CONSTRAINT IF EXISTS chk_qr_merchants_cerrado_inactivo;
ALTER TABLE qr_merchants DROP COLUMN IF EXISTS closed_at;

ALTER TABLE ledger_accounts DROP COLUMN IF EXISTS closed_at;

DROP INDEX IF EXISTS idx_users_por_desasociar;
DROP INDEX IF EXISTS idx_users_por_eliminar;

ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_blocked_coherente;
ALTER TABLE users ADD CONSTRAINT chk_users_blocked_coherente CHECK (
    (status = 'blocked' AND blocked_at IS NOT NULL AND blocked_reason IS NOT NULL)
    OR (status <> 'blocked' AND blocked_at IS NULL)
) NOT VALID;

ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_conservacion_coherente;
ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_por_eliminar_coherente;
ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_solicitud_completa;
ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_deletion_channel;

ALTER TABLE users DROP COLUMN IF EXISTS dissociated_at;
ALTER TABLE users DROP COLUMN IF EXISTS retention_extended_at;
ALTER TABLE users DROP COLUMN IF EXISTS retention_until;
ALTER TABLE users DROP COLUMN IF EXISTS deletion_channel;
ALTER TABLE users DROP COLUMN IF EXISTS deletion_terms_accepted_at;
ALTER TABLE users DROP COLUMN IF EXISTS deletion_due_at;
ALTER TABLE users DROP COLUMN IF EXISTS deletion_requested_at;

ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_status;
ALTER TABLE users ADD CONSTRAINT chk_users_status CHECK (
    status IN ('active', 'suspended', 'blocked', 'closed')
) NOT VALID;
