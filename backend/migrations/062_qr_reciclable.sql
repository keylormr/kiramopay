-- 062_qr_reciclable.sql
--
-- El QR deja de ser desechable.
--
-- Hasta hoy cada toque de "Generar QR" creaba una fila PERMANENTE y PAGABLE en
-- qr_payment_codes: la pantalla del comercio (BusinessHomeView) y la del inicio
-- (HomeView) creaban una identidad nueva por venta, y la base las acumulaba para
-- siempre. Y como CreateQRCode solo pone expires_at cuando single_use, un codigo
-- de comercio de julio sigue cobrando hoy: la foto de un QR viejo es dinero.
--
-- El modelo nuevo separa DOS cosas que estaban mezcladas en una sola fila:
--
--   * IDENTIDAD (qr_payment_codes con status='active'): una fila viva por
--     persona-y-moneda y por comercio-sucursal-y-moneda. Monto 0, no vence, no
--     se consume. Es el codigo que se imprime y se pega en el mostrador. Un pago
--     sobre el es siempre de monto abierto: el pagador teclea cuanto.
--
--   * COBRO (qr_charges, tabla nueva): una fila por venta, con monto, con su
--     PROPIO payload, con vencimiento, y que se reclama exactamente una vez.
--     Es lo que aparece en la pantalla del cajero.
--
-- El rotulo pegado en la pared no cambia jamas. El QR de la pantalla cambia en
-- cada venta, como hoy, pero ya no deja una fila pagable para siempre.
--
-- PRE-VUELO (fuera de esta migracion, contra la base viva):
--   SELECT tx_id, COUNT(*) FROM qr_payments
--    WHERE tx_id IS NOT NULL GROUP BY tx_id HAVING COUNT(*) > 1;
--   Si devuelve filas, NO desplegar: son ventas fantasma y el indice unico del
--   paso 4 se estrella. La regla del repositorio es no borrar registros, asi que
--   que hacer con ellas lo decide el dueno.

-- ── Paso 1 — columnas nuevas de la identidad ────────────────────────────────

ALTER TABLE qr_payment_codes ADD COLUMN IF NOT EXISTS status     VARCHAR(20) NOT NULL DEFAULT 'active';
ALTER TABLE qr_payment_codes ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;

ALTER TABLE qr_payment_codes DROP CONSTRAINT IF EXISTS chk_qr_code_status;
ALTER TABLE qr_payment_codes ADD  CONSTRAINT chk_qr_code_status
    CHECK (status IN ('active','revoked','historic'));

-- ── Paso 2 — retirar TODAS las filas viejas ─────────────────────────────────
--
-- Es el paso que hace encajar lo demas: sin el, los indices unicos parciales del
-- paso 3 se estrellan contra las N filas por usuario que ya existen.

-- Comercio: eran desechables por diseno (una por toque) y NO vencen. Una foto de
-- un QR de comercio de julio sigue cobrando hoy; esto lo cierra.
UPDATE qr_payment_codes
   SET status = 'revoked', revoked_at = NOW()
 WHERE merchant_id IS NOT NULL;

-- Personal: alguien pudo compartir ayer una solicitud de plata por WhatsApp. Se
-- conservan pagables por el camino legacy, con un techo de 30 dias para que no
-- vivan para siempre.
UPDATE qr_payment_codes
   SET status = 'historic',
       expires_at = LEAST(COALESCE(expires_at, NOW() + INTERVAL '30 days'),
                          NOW() + INTERVAL '30 days')
 WHERE merchant_id IS NULL;

-- ── Paso 3 — unicidad de la identidad, y la tabla de cobros ─────────────────
--
-- La unicidad que pidio el dueno: UN codigo por persona y moneda, UNO por
-- comercio-sucursal y moneda.
--
-- El COALESCE no es adorno: en un indice unico los NULL son distintos entre si,
-- asi que sin el, dos codigos "generales" del mismo comercio (location_id NULL)
-- pasarian los dos. Se usa COALESCE y no NULLS NOT DISTINCT para no depender de
-- la version de Postgres que sirva Neon.
CREATE UNIQUE INDEX IF NOT EXISTS ux_qr_code_persona
    ON qr_payment_codes (creator_id, currency)
    WHERE merchant_id IS NULL AND status = 'active';

CREATE UNIQUE INDEX IF NOT EXISTS ux_qr_code_comercio
    ON qr_payment_codes (merchant_id,
                         COALESCE(location_id, '00000000-0000-0000-0000-000000000000'::uuid),
                         currency)
    WHERE merchant_id IS NOT NULL AND status = 'active';

-- amount, note, single_use, used y expires_at quedan CONGELADAS en las filas
-- activas: leen bien y tienen datos, pero estan muertas. El CHECK existe para
-- que dentro de tres meses nadie vuelva a ramificar sobre qr.SingleUse y
-- reinstale el defecto. Pasa la validacion porque el paso 2 dejo cero filas
-- 'active'.
ALTER TABLE qr_payment_codes DROP CONSTRAINT IF EXISTS chk_qr_code_activo_sin_monto;
ALTER TABLE qr_payment_codes ADD  CONSTRAINT chk_qr_code_activo_sin_monto CHECK (
    status <> 'active'
    OR (COALESCE(amount,0) = 0 AND COALESCE(single_use,FALSE) = FALSE
        AND COALESCE(used,FALSE) = FALSE AND expires_at IS NULL)
) NOT VALID;
ALTER TABLE qr_payment_codes VALIDATE CONSTRAINT chk_qr_code_activo_sin_monto;

CREATE TABLE IF NOT EXISTS qr_charges (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    qr_code_id    UUID NOT NULL REFERENCES qr_payment_codes(id),
    merchant_id   UUID REFERENCES qr_merchants(id),
    location_id   UUID REFERENCES merchant_locations(id) ON DELETE SET NULL,
    created_by    UUID NOT NULL REFERENCES users(id),
    amount        BIGINT NOT NULL CHECK (amount > 0),   -- centimos
    currency      VARCHAR(10) NOT NULL,
    note          TEXT NOT NULL DEFAULT '',
    channel       VARCHAR(20) NOT NULL DEFAULT 'counter',
    status        VARCHAR(20) NOT NULL DEFAULT 'pending',
    qr_data       TEXT NOT NULL UNIQUE,
    expires_at    TIMESTAMPTZ NOT NULL,
    paid_by       UUID REFERENCES users(id),
    paid_tx_id    VARCHAR(100),
    paid_at       TIMESTAMPTZ,
    superseded_by UUID REFERENCES qr_charges(id),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_qr_charge_status  CHECK (status IN ('pending','paid','cancelled','expired','superseded')),
    CONSTRAINT chk_qr_charge_channel CHECK (channel IN ('counter','link'))
);

-- NO hay indice unico de "un solo cobro vivo por codigo", y es deliberado: como
-- el rotulo nunca resuelve a un cobro, no hay ambiguedad que desambiguar, y ese
-- indice solo serviria para serializar un local con dos cajas. Dos cajeros de la
-- misma sucursal pueden tener cobros pendientes a la vez, cada uno en su
-- pantalla, sin bloquearse.
CREATE INDEX IF NOT EXISTS idx_qr_charges_code_pend
    ON qr_charges (qr_code_id, created_at DESC) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_qr_charges_vencidos
    ON qr_charges (expires_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_qr_charges_creador
    ON qr_charges (created_by, created_at DESC);

-- ── Paso 4 — la venta apunta a su cobro, y deja de poder duplicarse ─────────

ALTER TABLE qr_payments ADD COLUMN IF NOT EXISTS charge_id UUID REFERENCES qr_charges(id);

-- Guarda contra la fila fantasma: idx_qr_payments_txid (migracion 018) NO es
-- unico, asi que dos escaneos concurrentes identicos podian colarse entre
-- GetPaymentByTxID y CreatePayment y dejar dos ventas para un solo asiento.
CREATE UNIQUE INDEX IF NOT EXISTS ux_qr_payments_txid
    ON qr_payments (tx_id) WHERE tx_id IS NOT NULL;

-- ── Paso 5 — el libro tiene que aceptar la llave nueva ─────────────────────
--
-- BLOQUEANTE. journal_postings.idempotency_key es VARCHAR(80) desde la 020, y la
-- 039 solo amplio transactions, no el libro. La llave de hoy mide 76 justos; la
-- nueva llega a 110. Sin esto, TODO pago QR falla con SQLSTATE 22001 — el mismo
-- error que la 039 vino a arreglar, un nivel mas abajo.
--
-- Ampliar un VARCHAR es cambio de metadatos: no reescribe la tabla ni invalida
-- el indice unico.
ALTER TABLE journal_postings ALTER COLUMN idempotency_key TYPE VARCHAR(160);

-- ── Paso 6 — el rotulo de cada comercio verificado, ya creado ──────────────
--
-- Son pocas filas y conviene que exista antes de que alguien abra la pantalla.
-- Las PERSONAS no se backfillean: son muchas y la mayoria nunca va a cobrar; su
-- codigo se crea la primera vez que abren "Cobrar".
--
-- gen_random_bytes viene de pgcrypto (001 y 024), ya usada asi en el backfill
-- de la 051.

INSERT INTO qr_payment_codes
    (id, creator_id, type, amount, currency, merchant_id, location_id,
     qr_data, single_use, used, status)
SELECT n.code_id, n.user_id, 'merchant_dynamic', 0, 'CRC', n.merchant_id, NULL,
       'KP:merchant_dynamic:' || substr(n.code_id::text, 1, 8)
         || ':0:CRC:i' || encode(gen_random_bytes(12), 'hex'),
       FALSE, FALSE, 'active'
  FROM (SELECT m.id AS merchant_id, m.user_id, gen_random_uuid() AS code_id
          FROM qr_merchants m
         WHERE m.verification_status = 'verified' AND m.active) n;

INSERT INTO qr_payment_codes
    (id, creator_id, type, amount, currency, merchant_id, location_id,
     qr_data, single_use, used, status)
SELECT n.code_id, n.user_id, 'merchant_dynamic', 0, 'CRC', n.merchant_id, n.location_id,
       'KP:merchant_dynamic:' || substr(n.code_id::text, 1, 8)
         || ':0:CRC:i' || encode(gen_random_bytes(12), 'hex'),
       FALSE, FALSE, 'active'
  FROM (SELECT m.id AS merchant_id, m.user_id, l.id AS location_id,
               gen_random_uuid() AS code_id
          FROM merchant_locations l
          JOIN qr_merchants m ON m.id = l.merchant_id
         WHERE l.active AND m.verification_status = 'verified' AND m.active) n;
