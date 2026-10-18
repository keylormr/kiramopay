-- Eliminacion de cuenta con plazo de gracia y conservacion legal.
--
-- Linea de tiempo (decision del dueno del 2026-10-18; el detalle por tabla esta
-- en internal/accountdeletion/clasificacion.go):
--
--   Dia 0   La persona lo pide y acepta expresamente el plazo. La cuenta queda en
--           'pending_deletion': sin sesiones, sin avisos, sin poder operar ni
--           recibir dinero. No se borra nada todavia.
--   0 a 30  Puede reactivarla al entrar con su contrasena; reactivar cancela el
--           proceso y deja la cuenta como estaba.
--   Dia 30  Un barrido la cierra. Se SUPRIME lo que la persona tiene derecho a
--           borrar (Ley 8968). Lo que la Ley 7786 (art. 16) y el Decreto 36948
--           (art. 21) obligan a conservar queda identificado y aislado: la
--           identidad pasa a closed_account_records y ninguna consulta de la
--           aplicacion la vuelve a ver.
--   +5 anos (10 con la marca de conservacion extendida) Otro barrido desasocia
--           lo conservado, de forma irreversible (Ley 8968 art. 6.1).
--
-- La fila de users NUNCA se borra: el diario del libro es append-only por
-- trigger (020), y ledger_accounts, escrow_agreements y payouts la referencian
-- con ON DELETE RESTRICT.
--
-- Aditiva y nulable: el binario viejo la ignora y no necesita coreografia de
-- despliegue (mismo criterio que la 052 y la 053).

-- ── 1. El estado de la cuenta mientras corre el plazo ─────────────────────
ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_status;
ALTER TABLE users ADD CONSTRAINT chk_users_status CHECK (
    status IN ('active', 'suspended', 'blocked', 'closed', 'pending_deletion')
) NOT VALID;
ALTER TABLE users VALIDATE CONSTRAINT chk_users_status;

-- ── 2. La solicitud y la conservacion ─────────────────────────────────────
-- deletion_requested_at: dia 0. deletion_due_at: dia 30, cuando la cierra el
-- barrido. deletion_terms_accepted_at: la aceptacion expresa del plazo, que la
-- solicitud exige. deletion_channel: por donde llego (in_app, web, admin).
-- retention_until: hasta cuando se conserva lo que la ley obliga (se fija al
-- cerrar). retention_extended_at: la marca de conservacion extendida a 10 anos
-- (la pone cumplimiento cuando corresponde; puede ponerse antes o despues del
-- cierre). dissociated_at: cuando se desasocio lo conservado.
ALTER TABLE users ADD COLUMN IF NOT EXISTS deletion_requested_at      TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS deletion_due_at            TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS deletion_terms_accepted_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS deletion_channel           VARCHAR(16);
ALTER TABLE users ADD COLUMN IF NOT EXISTS retention_until            TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS retention_extended_at      TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS dissociated_at             TIMESTAMPTZ;

ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_deletion_channel;
ALTER TABLE users ADD CONSTRAINT chk_users_deletion_channel
    CHECK (deletion_channel IS NULL OR deletion_channel IN ('in_app', 'web', 'admin'));

-- La solicitud esta entera o no esta: sin la aceptacion del plazo no hay
-- solicitud, y el cierre siempre es posterior al pedido.
ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_solicitud_completa;
ALTER TABLE users ADD CONSTRAINT chk_users_solicitud_completa CHECK (
    (deletion_requested_at IS NULL AND deletion_due_at IS NULL
     AND deletion_terms_accepted_at IS NULL AND deletion_channel IS NULL)
    OR (deletion_requested_at IS NOT NULL AND deletion_due_at > deletion_requested_at
        AND deletion_terms_accepted_at IS NOT NULL AND deletion_channel IS NOT NULL)
) NOT VALID;
ALTER TABLE users VALIDATE CONSTRAINT chk_users_solicitud_completa;

-- El estado y la solicitud cuentan la misma historia. 'pending_deletion' exige
-- la solicitud y una cuenta sin cerrar. Una cuenta ACTIVA nunca carga una
-- solicitud: reactivar la borra, y desbloquear una cuenta con la solicitud en
-- curso la devuelve a 'pending_deletion' (auth.UnblockUser). Una bloqueada o
-- suspendida si puede tenerla: la decision de la persona sigue en pie mientras
-- operaciones revisa la cuenta, y el barrido la cierra igual el dia 30.
ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_por_eliminar_coherente;
ALTER TABLE users ADD CONSTRAINT chk_users_por_eliminar_coherente CHECK (
    (status = 'pending_deletion' AND deletion_requested_at IS NOT NULL AND deleted_at IS NULL)
    OR (status <> 'pending_deletion'
        AND (deletion_requested_at IS NULL OR status IN ('blocked', 'suspended', 'closed')))
) NOT VALID;
ALTER TABLE users VALIDATE CONSTRAINT chk_users_por_eliminar_coherente;

-- La fecha de conservacion solo existe en una cuenta cerrada por este proceso,
-- y la desasociacion solo despues de fijarla.
ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_conservacion_coherente;
ALTER TABLE users ADD CONSTRAINT chk_users_conservacion_coherente CHECK (
    (retention_until IS NULL AND dissociated_at IS NULL)
    OR (retention_until IS NOT NULL AND status = 'closed' AND deleted_at IS NOT NULL
        AND deletion_requested_at IS NOT NULL)
) NOT VALID;
ALTER TABLE users VALIDATE CONSTRAINT chk_users_conservacion_coherente;

-- El rastro del bloqueo (cuando, por que y quien) sobrevive al cierre: es dato
-- de prevencion de fraude y se conserva como el resto de lo que la ley exige. La
-- 052 exigia blocked_at NULL fuera del estado 'blocked'; se relaja SOLO para
-- 'closed', de modo que cerrar una cuenta que estaba bloqueada no borre ese
-- rastro. 'pending_deletion' sigue sin admitirlo: una cuenta bloqueada que pide
-- la eliminacion conserva el estado 'blocked'.
ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_blocked_coherente;
ALTER TABLE users ADD CONSTRAINT chk_users_blocked_coherente CHECK (
    (status = 'blocked' AND blocked_at IS NOT NULL AND blocked_reason IS NOT NULL)
    OR status = 'closed'
    OR (status NOT IN ('blocked', 'closed') AND blocked_at IS NULL)
) NOT VALID;
ALTER TABLE users VALIDATE CONSTRAINT chk_users_blocked_coherente;

-- Lo que leen los dos barridos: las solicitudes en curso por fecha de cierre y
-- las cerradas por fecha de conservacion.
CREATE INDEX IF NOT EXISTS idx_users_por_eliminar ON users (deletion_due_at)
    WHERE deletion_requested_at IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_users_por_desasociar ON users (retention_until)
    WHERE retention_until IS NOT NULL AND dissociated_at IS NULL;

-- ── 3. Cuentas del libro cerradas ─────────────────────────────────────────
-- El motor resuelve la cuenta de cada asiento en ledger.resolveAccount. Con
-- closed_at puesto, esa resolucion se niega: ninguna transferencia, escrow ni
-- cobro puede acreditar o debitar la cuenta de una persona que pidio cerrarla,
-- aunque un cliente conserve su id. Se cierran el dia 0 y se reabren si la
-- persona reactiva. Las filas del diario no se tocan.
ALTER TABLE ledger_accounts ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;

-- ── 4. Comercios cerrados ─────────────────────────────────────────────────
-- El comercio de una cuenta cerrada queda cerrado e inactivo, sin borrarse: su
-- identidad legal y sus cobros son parte de lo que se conserva. Un comercio
-- cerrado no se puede volver a activar.
ALTER TABLE qr_merchants ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;
ALTER TABLE qr_merchants DROP CONSTRAINT IF EXISTS chk_qr_merchants_cerrado_inactivo;
ALTER TABLE qr_merchants ADD CONSTRAINT chk_qr_merchants_cerrado_inactivo
    CHECK (closed_at IS NULL OR active = false) NOT VALID;
ALTER TABLE qr_merchants VALIDATE CONSTRAINT chk_qr_merchants_cerrado_inactivo;

-- ── 5. La identidad que se conserva, aislada ──────────────────────────────
-- El dia 30 la identificacion de la persona sale de users (que queda como una
-- fila sin datos personales, para que nadie la encuentre y la persona pueda
-- volver a registrarse) y se guarda aqui, con el mismo cifrado. Ninguna consulta
-- de la aplicacion lee esta tabla: es el expediente que la Ley 7786 obliga a
-- conservar, para cumplimiento y para las autoridades. Al vencer la
-- conservacion se vacia y queda dissociated_at como rastro.
CREATE TABLE IF NOT EXISTS closed_account_records (
    user_id        UUID PRIMARY KEY REFERENCES users(id),
    first_name     VARCHAR(100),
    last_name      VARCHAR(100),
    birth_date     DATE,
    birth_date_enc BYTEA,
    cedula_hash    VARCHAR(64),
    cedula_enc     BYTEA,
    phone_hash     VARCHAR(64),
    phone_enc      BYTEA,
    email_hash     VARCHAR(64),
    email_enc      BYTEA,
    closed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    dissociated_at TIMESTAMPTZ,
    CONSTRAINT chk_car_desasociada_vacia CHECK (
        dissociated_at IS NULL
        OR (first_name IS NULL AND last_name IS NULL AND birth_date IS NULL
            AND birth_date_enc IS NULL AND cedula_hash IS NULL AND cedula_enc IS NULL
            AND phone_hash IS NULL AND phone_enc IS NULL
            AND email_hash IS NULL AND email_enc IS NULL)
    )
);

-- Cumplimiento busca un expediente por la cedula, con el mismo HMAC de users.
-- No es unico: la misma persona puede cerrar mas de una cuenta en su vida.
CREATE INDEX IF NOT EXISTS idx_car_cedula ON closed_account_records (cedula_hash)
    WHERE cedula_hash IS NOT NULL;

-- ── 6. Solicitudes hechas desde la pagina web ─────────────────────────────
-- La persona que desinstalo la app (o no puede entrar) pide la eliminacion en
-- /eliminar-cuenta. Al comprobar el codigo empieza el plazo, igual que en la
-- app. Solo llegan a una persona de operaciones las cuentas bajo revision.
--
-- Solo guarda lo imprescindible y NADA legible: el contacto va como HMAC (el
-- mismo fn_pii_hmac de los lookups), el codigo de verificacion como SHA-256, y
-- no hay texto libre ni IP. La solicitud sin cuenta asociada (user_id NULL) es
-- deliberada: el formulario responde igual exista o no la cuenta, para no ser
-- un oraculo de enumeracion.
--
-- status: pending_verification (esperando el codigo), verified (codigo bueno,
-- la cuenta esta bajo revision y la atiende una persona), scheduled (empezo el
-- plazo), blocked (hay algo que resolver antes; se le escribio a la persona),
-- rejected, expired, cancelled (la persona reactivo antes del dia 30).
CREATE TABLE IF NOT EXISTS account_deletion_requests (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contact_kind            VARCHAR(8)  NOT NULL,
    contact_hash            VARCHAR(64) NOT NULL,
    user_id                 UUID REFERENCES users(id),
    status                  VARCHAR(24) NOT NULL DEFAULT 'pending_verification',
    verification_hash       VARCHAR(64),
    verification_attempts   INTEGER     NOT NULL DEFAULT 0,
    verification_expires_at TIMESTAMPTZ,
    terms_accepted_at       TIMESTAMPTZ NOT NULL,
    result_code             VARCHAR(40),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    verified_at             TIMESTAMPTZ,
    processed_at            TIMESTAMPTZ,
    processed_by            UUID REFERENCES users(id),
    CONSTRAINT chk_adr_contact_kind CHECK (contact_kind IN ('email', 'phone')),
    CONSTRAINT chk_adr_status CHECK (status IN
        ('pending_verification', 'verified', 'scheduled', 'blocked', 'rejected', 'expired', 'cancelled')),
    CONSTRAINT chk_adr_attempts CHECK (verification_attempts >= 0)
);

-- Una sola solicitud abierta por contacto: pedir otra vez renueva el codigo en
-- lugar de acumular filas.
CREATE UNIQUE INDEX IF NOT EXISTS uq_adr_contacto_abierto
    ON account_deletion_requests (contact_hash)
    WHERE status IN ('pending_verification', 'verified');

-- Lo que lista el panel: las que esperan a una persona, la mas antigua primero.
CREATE INDEX IF NOT EXISTS idx_adr_verificadas
    ON account_deletion_requests (verified_at)
    WHERE status = 'verified';
