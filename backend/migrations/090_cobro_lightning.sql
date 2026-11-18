-- 090: el comercio cobra con bitcoin Lightning en su billetera propia.
--
-- Un turista paga el cobro del mostrador con cualquier billetera Lightning y el
-- bitcoin llega a la billetera propia del comercio, cuyas llaves estan en el
-- telefono del dueno. El servidor NO recibe, no guarda y no mueve bitcoin, y no
-- tiene llaves:
--
--   * le pide la factura a la direccion Lightning del comercio (LUD-16/LUD-06),
--   * guarda la factura, su payment hash y la URL de verificacion (LUD-21),
--   * y marca el cobro pagado solo cuando esa URL devuelve un preimage cuyo
--     SHA-256 es el payment hash. Sin preimage no hay "pagado".
--
-- Nada de esto toca el libro: un cobro por Lightning no suma al saldo del
-- negocio en KiramoPay.

-- Como cobra el comercio fuera del libro: su direccion Lightning y su numero
-- de SINPE Movil. En una tabla aparte para no correr las columnas de
-- qr_merchants, que se leen por posicion en muchas consultas.
CREATE TABLE IF NOT EXISTS merchant_payment_methods (
    merchant_id       UUID PRIMARY KEY REFERENCES qr_merchants(id),
    lightning_address VARCHAR(320),
    sinpe_movil       VARCHAR(8),
    updated_by        UUID NOT NULL REFERENCES users(id),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Un celular de Costa Rica, 8 digitos, sin guion ni +506.
    CONSTRAINT chk_mpm_sinpe CHECK (sinpe_movil IS NULL OR sinpe_movil ~ '^[5-8][0-9]{7}$')
);

-- Por donde se pago un cobro. NULL es el de siempre: un pagador de KiramoPay,
-- con su asiento en el libro (paid_by y paid_tx_id).
ALTER TABLE qr_charges ADD COLUMN IF NOT EXISTS paid_via VARCHAR(20);
ALTER TABLE qr_charges DROP CONSTRAINT IF EXISTS chk_qr_charge_paid_via;
ALTER TABLE qr_charges ADD  CONSTRAINT chk_qr_charge_paid_via
    CHECK (paid_via IS NULL OR paid_via = 'lightning');

-- Una factura Lightning de un cobro. Un cobro puede tener varias: la
-- cotizacion dura 10 minutos y despues se pide otra con el precio del momento.
CREATE TABLE IF NOT EXISTS qr_charge_lightning (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    charge_id          UUID NOT NULL REFERENCES qr_charges(id),
    merchant_id        UUID NOT NULL REFERENCES qr_merchants(id),
    created_by         UUID NOT NULL REFERENCES users(id),
    lightning_address  VARCHAR(320) NOT NULL,
    invoice            TEXT NOT NULL,
    payment_hash       CHAR(64) NOT NULL UNIQUE,
    amount_msat        BIGINT NOT NULL,
    sats               BIGINT NOT NULL CHECK (sats > 0),
    -- El precio de la venta, en centimos de la moneda del cobro.
    fiat_amount        BIGINT NOT NULL CHECK (fiat_amount > 0),
    currency           VARCHAR(10) NOT NULL,
    -- Con que se cotizo: un bitcoin en la moneda del cobro, un bitcoin en
    -- dolares y el tipo de cambio del dolar (NULL si el cobro es en dolares).
    btc_price          NUMERIC(24,6) NOT NULL CHECK (btc_price > 0),
    btc_usd            NUMERIC(24,6) NOT NULL CHECK (btc_usd > 0),
    usd_rate           NUMERIC(18,6),
    verify_url         TEXT NOT NULL,
    quote_expires_at   TIMESTAMPTZ NOT NULL,
    invoice_expires_at TIMESTAMPTZ NOT NULL,
    status             VARCHAR(20) NOT NULL DEFAULT 'pending',
    preimage           CHAR(64),
    paid_at            TIMESTAMPTZ,
    checked_at         TIMESTAMPTZ,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_qcl_status CHECK (status IN ('pending','paid','expired')),
    -- Pagada si y solo si hay preimage: es la prueba de pago.
    CONSTRAINT chk_qcl_pagada CHECK ((status = 'paid') = (preimage IS NOT NULL AND paid_at IS NOT NULL)),
    CONSTRAINT chk_qcl_msat CHECK (amount_msat = sats * 1000)
);
CREATE INDEX IF NOT EXISTS idx_qcl_cobro
    ON qr_charge_lightning (charge_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_qcl_pendientes
    ON qr_charge_lightning (invoice_expires_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_qcl_pagadas
    ON qr_charge_lightning (merchant_id, paid_at) WHERE status = 'paid';
