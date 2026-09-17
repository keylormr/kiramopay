-- Enviar cripto a otra persona de KiramoPay.
--
-- La pantalla de cripto ofrecia "Enviar" desde siempre y el backend nunca tuvo
-- a donde mandarlo: el boton descontaba el saldo SOLO en la memoria del
-- telefono, inventaba una comision de red del 0,01 % y un txHash al azar. La
-- cripto de esta aplicacion no vive en ninguna cadena, asi que "enviar a una
-- direccion" no existe ni puede existir. Lo que si existe —y es lo que esta
-- migracion habilita— es mover el activo de una persona de KiramoPay a otra,
-- identificada por su codigo QR permanente.
--
-- Tres cosas hacen falta para que ese movimiento sea auditable:
--
--   1. Saber A QUIEN se le envio. crypto_transactions no tenia contraparte:
--      un 'send' no decia a donde fue y un 'receive' no decia de donde vino.
--   2. Que un reintento no envie dos veces. La llave de idempotencia es la
--      misma idea que ya usan las transferencias del libro.
--   3. Que la comision de KiramoPay quede anotada. Se cobra en la MISMA cripto
--      (0,25 %, la paga quien envia), y las cuentas de comisiones del libro
--      —SYSTEM:FEES:CRC y SYSTEM:FEES:USD— son de fiat: no pueden guardar BTC.

BEGIN;

-- ── 1. La contraparte y la llave ────────────────────────────────────────────

-- counterparty_name se guarda aunque se pueda derivar del id: es el nombre con
-- el que la pantalla confirmo el envio. Si esa persona se cambia el nombre
-- despues, el comprobante tiene que seguir diciendo a quien se le envio ese dia.
-- Es lo mismo que hace transactions.counterparty_name.
ALTER TABLE crypto_transactions
    ADD COLUMN IF NOT EXISTS counterparty_user_id UUID REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS counterparty_name    VARCHAR(160),
    ADD COLUMN IF NOT EXISTS idempotency_key      VARCHAR(140);

-- La llave nombra UN intento de UNA persona. Global no sirve: la pata del que
-- recibe se escribe con la misma llave mas ":recv", y dos personas distintas
-- pueden traer llaves iguales si el cliente las genera sin sal.
CREATE UNIQUE INDEX IF NOT EXISTS uq_crypto_tx_llave
    ON crypto_transactions (user_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

-- Lo que consulta la pantalla del que recibe para saber quien le envio.
CREATE INDEX IF NOT EXISTS idx_crypto_tx_contraparte
    ON crypto_transactions (counterparty_user_id, created_at DESC)
    WHERE counterparty_user_id IS NOT NULL;

-- ── 2. La comision, en cripto ───────────────────────────────────────────────

-- Cada fila es una comision cobrada por un envio: cuanto, de que activo, a
-- quien se le cobro y por cual movimiento.
--
-- Vive aparte de crypto_assets a proposito. crypto_assets.user_id apunta a
-- users, asi que la plataforma no puede tener una fila ahi sin inventarse un
-- usuario. Y sobre todo: esto no es el saldo de nadie, es lo que KiramoPay
-- cobro. La suma de crypto_assets.balance mas la de esta tabla, por activo, es
-- la cantidad que la plataforma dice tener — es la cuadratura que permite
-- revisar que un envio no evaporo cripto.
CREATE TABLE IF NOT EXISTS crypto_platform_fees (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL REFERENCES users(id),
    crypto_tx_id  UUID NOT NULL,
    asset         VARCHAR(20) NOT NULL,
    amount        NUMERIC(38, 18) NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_crypto_fee_positiva CHECK (amount > 0)
);

-- Una comision por movimiento. Si el envio se reintenta bajo la misma llave, el
-- movimiento es el mismo y esta fila no se duplica.
CREATE UNIQUE INDEX IF NOT EXISTS uq_crypto_fee_por_movimiento
    ON crypto_platform_fees (crypto_tx_id);

CREATE INDEX IF NOT EXISTS idx_crypto_fees_activo
    ON crypto_platform_fees (asset, created_at DESC);

COMMIT;
