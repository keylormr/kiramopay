-- Migracion 083: la respuesta escrita a una solicitud de eliminacion queda en
-- una bandeja hasta que se entrega.
--
-- Decision del dueno (2026-10-20): la respuesta del dia 0 (Ley 8968 art. 7,
-- Reglamento arts. 18 y 22: que se suprime el dia 30, que se conserva por la Ley
-- 7786 y hasta cuando, y el derecho a acudir a la PRODHAB) ya no se manda de
-- mejor esfuerzo. Antes salia en una goroutine despues del commit: sin correo
-- en la cuenta, con el proveedor caido o con un reinicio en el medio, la persona
-- no recibia nada y solo quedaba una advertencia en el log.
--
--   * La fila se escribe en la MISMA transaccion del dia 0 (o de la solicitud
--     web que quedo bloqueada): si la solicitud quedo, la respuesta tambien.
--   * El barrido de la eliminacion la reintenta con espera creciente. Cada
--     intento reserva la fila antes de mandar, para que nunca salga dos veces.
--   * Sin a donde mandarla, o si a las 48 horas sigue sin salir, la fila pasa al
--     panel de operaciones (escalated_at). Una persona la atiende por otro medio
--     y la marca entregada con una nota (delivered_via = 'manual').
--   * delivered_at es la constancia: cuando el proveedor de correo la acepto, o
--     cuando operaciones la entrego. No dice que llego al buzon.
--   * email_enc es el correo que dio, solo para esta respuesta, una persona cuya
--     cuenta no tiene correo. Va cifrado como el resto de la PII y se borra al
--     entregarla, al cancelarla y el dia 30. Se pide dos veces, pero nadie lo
--     confirma: email_unconfirmed lo marca, y la marca queda despues de borrarlo
--     para que el panel sepa a que se dio por entregada.
--   * last_error guarda un codigo y nunca el texto del proveedor: un rebote de
--     SMTP trae la direccion adentro.
--   * Toda solicitud web verificada tiene la suya, tambien la rechazada
--     (rejected), y respond_by se cuenta desde la verificacion aunque
--     operaciones la atienda dias despues.
--
-- No apunta a account_deletion_requests: la bajada de la 077 borra esa tabla.
CREATE TABLE IF NOT EXISTS account_deletion_responses (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id),
    kind            VARCHAR(12) NOT NULL,
    deletion_due_at TIMESTAMPTZ,
    blockers        TEXT[] NOT NULL DEFAULT '{}',
    email_enc       BYTEA,
    email_unconfirmed BOOLEAN NOT NULL DEFAULT false,
    respond_by      TIMESTAMPTZ NOT NULL,
    attempts        INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_error      VARCHAR(16),
    escalated_at    TIMESTAMPTZ,
    delivered_at    TIMESTAMPTZ,
    delivered_via   VARCHAR(8),
    delivered_by    UUID REFERENCES users(id),
    delivery_note   TEXT,
    cancelled_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- scheduled: empezo el plazo de 30 dias. blocked: la solicitud web no pudo
    -- empezar y se le dice a la persona que resolver. rejected: la solicitud web
    -- no se atiende por esta via, sin decir por que.
    CONSTRAINT chk_adresp_kind CHECK (kind IN ('scheduled', 'blocked', 'rejected')),
    CONSTRAINT chk_adresp_fecha CHECK (kind <> 'scheduled' OR deletion_due_at IS NOT NULL),
    CONSTRAINT chk_adresp_intentos CHECK (attempts >= 0),
    CONSTRAINT chk_adresp_error CHECK (last_error IS NULL OR last_error IN ('no_channel', 'send_failed')),
    CONSTRAINT chk_adresp_via CHECK (delivered_via IS NULL OR delivered_via IN ('email', 'manual')),
    CONSTRAINT chk_adresp_entregada CHECK ((delivered_at IS NULL) = (delivered_via IS NULL)),
    CONSTRAINT chk_adresp_manual CHECK (delivered_via IS DISTINCT FROM 'manual' OR delivered_by IS NOT NULL),
    CONSTRAINT chk_adresp_una_salida CHECK (delivered_at IS NULL OR cancelled_at IS NULL)
);

-- Lo que el barrido recorre: las que faltan, por turno.
CREATE INDEX IF NOT EXISTS idx_adresp_por_entregar
    ON account_deletion_responses (next_attempt_at)
    WHERE delivered_at IS NULL AND cancelled_at IS NULL;

-- Lo que lista el panel: las que pasaron a operaciones, la mas urgente primero.
CREATE INDEX IF NOT EXISTS idx_adresp_en_operaciones
    ON account_deletion_responses (respond_by)
    WHERE escalated_at IS NOT NULL AND delivered_at IS NULL AND cancelled_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_adresp_cuenta ON account_deletion_responses (user_id);
