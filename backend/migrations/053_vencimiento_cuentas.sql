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
--
-- Va sin CONCURRENTLY, dentro de la transaccion del runner, a diferencia de lo
-- que recomienda ZERO_DOWNTIME_MIGRATIONS.md para indices nuevos. Es una
-- decision consciente al volumen actual de users (cientos de filas: el build
-- dura menos que el propio arranque) y sigue el precedente de idx_users_blocked
-- en la 052. El camino CONCURRENTLY exige un archivo con la directiva
-- -- migrate:no-transaction y una sola sentencia, y tiene un modo de fallo peor
-- para este tamano: si el build se corta deja un indice INVALIDO que el
-- IF NOT EXISTS de un reintento da por bueno, y el barrido se queda escaneando
-- la tabla sin que nada lo diga. CAMBIAR A CONCURRENTLY cuando users pase de
-- unos cuantos miles de filas, que es donde el lock de escritura empieza a
-- durar lo suficiente para encolar logins y registros.
CREATE INDEX IF NOT EXISTS idx_users_expires_at ON users (expires_at)
    WHERE expires_at IS NOT NULL AND status <> 'blocked' AND deleted_at IS NULL;

COMMENT ON COLUMN users.expires_at IS
    'Momento a partir del cual el barrido bloquea la cuenta (motivo: demo vencido). NULL = no vence.';
