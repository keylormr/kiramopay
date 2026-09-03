-- Vencimiento programado de cuentas. users.expires_at es el momento a partir
-- del cual el barrido de la API bloquea la cuenta con motivo "demo vencido";
-- NULL significa que no vence, que es el caso de todas las cuentas existentes.
-- Puramente aditiva y nulable, sin backfill: el binario viejo la ignora y no
-- necesita coreografia de despliegue.
ALTER TABLE users ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

-- El indice espeja EXACTAMENTE el filtro del barrido (ver
-- user.Repository.ListDueForExpiry) para que cada tick lea unas pocas filas
-- en vez de recorrer users entera. Un predicado mas laxo aqui haria que el
-- planificador lo descarte.
CREATE INDEX IF NOT EXISTS idx_users_expires_at ON users (expires_at)
    WHERE expires_at IS NOT NULL AND status <> 'blocked' AND deleted_at IS NULL;

COMMENT ON COLUMN users.expires_at IS
    'Momento a partir del cual el barrido bloquea la cuenta (motivo: demo vencido). NULL = no vence.';
