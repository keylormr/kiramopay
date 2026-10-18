-- Bajada de 077_eliminacion_de_cuenta.sql
--
-- Quita las columnas y la tabla. NO deshace las anonimizaciones ya hechas: los
-- datos personales que se borraron no vuelven, por eso la subida es de un solo
-- sentido en lo que toca a los datos. Las cuentas que quedaron como tumba
-- siguen con status 'closed' y su PII borrada.

DROP TABLE IF EXISTS account_deletion_requests;

ALTER TABLE ledger_accounts DROP COLUMN IF EXISTS closed_at;

-- Se restaura el CHECK de la 052 como NOT VALID: una tumba que conserve
-- blocked_at lo violaria, y la bajada no debe fallar por eso ni borrar el rastro.
ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_blocked_coherente;
ALTER TABLE users ADD CONSTRAINT chk_users_blocked_coherente CHECK (
    (status = 'blocked' AND blocked_at IS NOT NULL AND blocked_reason IS NOT NULL)
    OR (status <> 'blocked' AND blocked_at IS NULL)
) NOT VALID;

ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_anonimizada_coherente;
ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_deletion_channel;
ALTER TABLE users DROP COLUMN IF EXISTS deletion_channel;
ALTER TABLE users DROP COLUMN IF EXISTS anonymized_at;
