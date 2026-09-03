-- Bloqueo remoto de cuentas. El estado vive en users.status ('blocked' ya esta en
-- chk_users_status desde la 018); estas columnas son el RASTRO: cuando, por que y quien.
-- Puramente aditiva y nulable: el binario viejo la ignora, no necesita coreografia.
ALTER TABLE users ADD COLUMN IF NOT EXISTS blocked_at     TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS blocked_reason TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS blocked_by     UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_blocked_reason_len;
ALTER TABLE users ADD CONSTRAINT chk_users_blocked_reason_len
    CHECK (blocked_reason IS NULL OR char_length(blocked_reason) <= 500);
ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_blocked_coherente;
ALTER TABLE users ADD CONSTRAINT chk_users_blocked_coherente CHECK (
    (status = 'blocked' AND blocked_at IS NOT NULL AND blocked_reason IS NOT NULL)
    OR (status <> 'blocked' AND blocked_at IS NULL)
) NOT VALID;
ALTER TABLE users VALIDATE CONSTRAINT chk_users_blocked_coherente;
CREATE INDEX IF NOT EXISTS idx_users_blocked ON users (blocked_at DESC) WHERE status = 'blocked';
