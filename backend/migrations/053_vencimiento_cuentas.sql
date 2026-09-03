-- Vencimiento programado de cuentas. users.expires_at es el momento a partir
-- del cual el barrido de la API bloquea la cuenta con motivo "demo vencido";
-- NULL significa que no vence, que es el caso de todas las cuentas existentes.
-- Puramente aditiva y nulable, sin backfill: el binario viejo la ignora y no
-- necesita coreografia de despliegue.
ALTER TABLE users ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

COMMENT ON COLUMN users.expires_at IS
    'Momento a partir del cual el barrido bloquea la cuenta (motivo: demo vencido). NULL = no vence.';
