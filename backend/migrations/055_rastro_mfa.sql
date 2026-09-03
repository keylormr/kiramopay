-- Rastro al apagar el segundo factor.
--
-- Hasta ahora, desactivar el TOTP borraba la fila de user_totp y todos los
-- codigos de recuperacion. Quitar un control de acceso no es borrar el
-- registro: se pierde para siempre que la cuenta tuvo segundo factor, desde
-- cuando y hasta cuando, y eso es justo lo que hay que poder reconstruir
-- despues de una toma de cuenta.
--
-- Mismo patron que user_sessions.revoked_at: la fila se queda y se marca.
-- Aditivas y nulables, sin backfill.
ALTER TABLE user_totp ADD COLUMN IF NOT EXISTS disabled_at TIMESTAMP;
ALTER TABLE totp_recovery_codes ADD COLUMN IF NOT EXISTS invalidated_at TIMESTAMP;

COMMENT ON COLUMN user_totp.disabled_at IS
    'Cuando se apago el segundo factor. NULL = nunca se apago (la fila dice si esta activo en enabled).';
COMMENT ON COLUMN totp_recovery_codes.invalidated_at IS
    'Cuando el codigo dejo de servir sin que nadie lo usara (se apago el MFA o se regenero el lote). Distinto de used_at, que es haberlo usado.';

-- idx_totp_recovery_unused (WHERE used_at IS NULL) se deja como esta: la
-- consulta de codigos vivos agrega "AND invalidated_at IS NULL", que implica su
-- predicado, asi que el planificador lo sigue pudiendo usar.
