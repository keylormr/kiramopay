-- Eliminacion de cuenta (politica de Google Play) sin tocar el historial del dinero.
--
-- La fila de users NUNCA se borra: el diario del libro es append-only por
-- trigger (020), y ledger_accounts, escrow_agreements y payouts la referencian
-- con ON DELETE RESTRICT. Eliminar una cuenta es dejarla como TUMBA: la misma
-- fila, anonimizada, con status 'closed'. Lo que borra o anonimiza cada tabla
-- esta en internal/accountdeletion/clasificacion.go; esta migracion solo trae
-- las columnas y la tabla que hacen falta.
--
-- Puramente aditiva y nulable: el binario viejo la ignora, no necesita
-- coreografia de despliegue (mismo criterio que la 052 y la 053).

-- ── 1. La tumba ───────────────────────────────────────────────────────────
-- anonymized_at: el momento en que se borro la PII. deleted_at ya existia desde
-- la 001 y todas las busquedas ya lo filtran; anonymized_at distingue "cuenta
-- cerrada y anonimizada" de un soft-delete antiguo sin tratar.
-- deletion_channel: por donde llego la solicitud (in_app, web, admin).
ALTER TABLE users ADD COLUMN IF NOT EXISTS anonymized_at    TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS deletion_channel VARCHAR(16);

ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_deletion_channel;
ALTER TABLE users ADD CONSTRAINT chk_users_deletion_channel
    CHECK (deletion_channel IS NULL OR deletion_channel IN ('in_app', 'web', 'admin'));

-- Una tumba esta completa o no existe: o no tiene ninguno de los dos rastros, o
-- tiene los dos, esta cerrada y tiene deleted_at. Evita una cuenta a medias.
ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_anonimizada_coherente;
ALTER TABLE users ADD CONSTRAINT chk_users_anonimizada_coherente CHECK (
    (anonymized_at IS NULL AND deletion_channel IS NULL)
    OR (anonymized_at IS NOT NULL AND deletion_channel IS NOT NULL
        AND status = 'closed' AND deleted_at IS NOT NULL)
) NOT VALID;
ALTER TABLE users VALIDATE CONSTRAINT chk_users_anonimizada_coherente;

-- El rastro del bloqueo (cuando, por que y quien) sobrevive al cierre: es dato
-- de prevencion de fraude y de cumplimiento, y la decision de cuanto
-- conservarlo es del abogado, no de esta migracion. La 052 exigia
-- blocked_at NULL fuera del estado 'blocked'; se relaja SOLO para 'closed', de
-- modo que cerrar una cuenta que estaba bloqueada no borre ese rastro.
ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_blocked_coherente;
ALTER TABLE users ADD CONSTRAINT chk_users_blocked_coherente CHECK (
    (status = 'blocked' AND blocked_at IS NOT NULL AND blocked_reason IS NOT NULL)
    OR status = 'closed'
    OR (status NOT IN ('blocked', 'closed') AND blocked_at IS NULL)
) NOT VALID;
ALTER TABLE users VALIDATE CONSTRAINT chk_users_blocked_coherente;

-- ── 2. Cuentas del libro cerradas ─────────────────────────────────────────
-- El motor resuelve la cuenta de cada asiento en ledger.resolveAccount. Con
-- closed_at puesto, esa resolucion se niega: ninguna transferencia, escrow ni
-- cobro puede acreditar o debitar la cuenta de una persona que ya no existe,
-- aunque un cliente conserve su id de antes. Las filas del diario no se tocan.
ALTER TABLE ledger_accounts ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;

-- ── 3. Solicitudes hechas desde la pagina web ─────────────────────────────
-- La persona que desinstalo la app (o no puede entrar) pide la eliminacion en
-- /eliminar-cuenta. Esta tabla es la cola que atiende operaciones.
--
-- Solo guarda lo imprescindible y NADA legible: el contacto va como HMAC (el
-- mismo fn_pii_hmac de los lookups), el codigo de verificacion como SHA-256, y
-- no hay texto libre ni IP. La solicitud sin cuenta asociada (user_id NULL) es
-- deliberada: el formulario responde igual exista o no la cuenta, para no ser
-- un oraculo de enumeracion.
CREATE TABLE IF NOT EXISTS account_deletion_requests (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contact_kind          VARCHAR(8)  NOT NULL,
    contact_hash          VARCHAR(64) NOT NULL,
    user_id               UUID REFERENCES users(id),
    status                VARCHAR(24) NOT NULL DEFAULT 'pending_verification',
    verification_hash     VARCHAR(64),
    verification_attempts INTEGER     NOT NULL DEFAULT 0,
    verification_expires_at TIMESTAMPTZ,
    result_code           VARCHAR(40),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    verified_at           TIMESTAMPTZ,
    processed_at          TIMESTAMPTZ,
    processed_by          UUID REFERENCES users(id),
    CONSTRAINT chk_adr_contact_kind CHECK (contact_kind IN ('email', 'phone')),
    CONSTRAINT chk_adr_status CHECK (status IN
        ('pending_verification', 'verified', 'completed', 'blocked', 'rejected', 'expired')),
    CONSTRAINT chk_adr_attempts CHECK (verification_attempts >= 0)
);

-- Una sola solicitud abierta por contacto: pedir otra vez renueva el codigo en
-- lugar de acumular filas.
CREATE UNIQUE INDEX IF NOT EXISTS uq_adr_contacto_abierto
    ON account_deletion_requests (contact_hash)
    WHERE status IN ('pending_verification', 'verified');

-- Lo que lista el panel: las verificadas, la mas antigua primero.
CREATE INDEX IF NOT EXISTS idx_adr_verificadas
    ON account_deletion_requests (verified_at)
    WHERE status = 'verified';
