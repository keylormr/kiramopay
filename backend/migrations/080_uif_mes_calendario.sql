-- Transacciones multiples por mes calendario.
--
-- SUGEF 13-19 (art. 20 y Lineamiento 22.2) acumula las transacciones multiples
-- por cliente en el MES CALENDARIO, "en efectivo o por cualquier otro medio de
-- pago", y el registro se dispara al llegar a US$10.000. Cada transaccion se
-- registra con su fecha, moneda y monto originales. El tipo de cambio es la
-- venta de referencia del BCCR (el Lin. 20.3 remite al art. 12 del RIF,
-- CONASSIF 6-18), y el total del mes se convierte con la del ultimo dia del mes.
--
-- La 065 media otra cosa: una ventana movil de 30 dias, solo de salidas, con el
-- tipo de cambio de hoy. Un movimiento del mes pasado contaba para este, las
-- entradas no contaban nunca y el colon de hace tres semanas valia lo de hoy.
-- Esa ventana queda como alerta interna de estructuracion, con tipo propio.

-- La venta de referencia de CADA DIA, con la fecha que le pone el BCCR.
-- exchange_rates guarda una fila solo cuando la tasa cambia, con la hora en que
-- se trajo: no dice cual era la venta de un dia dado. por_dolar es cuantas
-- unidades de la moneda vale un dolar (la venta en colones; para el euro, la
-- inversa de los dolares por euro que publica el BCCR).
CREATE TABLE IF NOT EXISTS tipo_de_cambio_diario (
    moneda        VARCHAR(10)    NOT NULL,
    fecha         DATE           NOT NULL,
    por_dolar     NUMERIC(20,10) NOT NULL CHECK (por_dolar > 0),
    fuente        VARCHAR(30)    NOT NULL,
    registrado_en TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    PRIMARY KEY (moneda, fecha)
);

-- Cada movimiento evaluado, con su equivalente en dolares y con que tasa, de
-- que fecha y de donde salio. Sin tasa, los cuatro van vacios y el movimiento
-- se fue a revision manual. mes es el primer dia del mes calendario de Costa
-- Rica. tx_id no tiene llave foranea: escrow, payouts y cripto avisan con el id
-- de su propio registro.
CREATE TABLE IF NOT EXISTS uif_movimientos (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id),
    tx_id       UUID NOT NULL,
    sentido     VARCHAR(10) NOT NULL CHECK (sentido IN ('salida', 'entrada')),
    moneda      VARCHAR(10) NOT NULL,
    monto_minor BIGINT NOT NULL,
    usd_minor   BIGINT,
    tasa        NUMERIC(20,10),
    tasa_fecha  DATE,
    tasa_fuente VARCHAR(30),
    mes         DATE NOT NULL,
    evaluado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_uif_movimientos_tx UNIQUE (tx_id, sentido),
    CONSTRAINT chk_uif_movimientos_tasa CHECK (
        (usd_minor IS NULL AND tasa IS NULL AND tasa_fecha IS NULL AND tasa_fuente IS NULL)
        OR (usd_minor IS NOT NULL AND tasa IS NOT NULL AND tasa_fecha IS NOT NULL AND tasa_fuente IS NOT NULL)
    )
);
CREATE INDEX IF NOT EXISTS idx_uif_movimientos_mes ON uif_movimientos (user_id, mes);

-- Tipos nuevos. acumulado_30d queda en la lista por los casos que ya existen:
-- no se reescriben.
ALTER TABLE uif_reports DROP CONSTRAINT IF EXISTS chk_uif_type;
ALTER TABLE uif_reports
    ADD CONSTRAINT chk_uif_type
    CHECK (report_type IN ('single_threshold', 'structuring', 'manual', 'acumulado_30d',
                           'multiples_mes', 'cierre_mes', 'estructuracion_30d'));

-- El mes calendario del caso y lo que el cliente saco y recibio en el, en
-- centavos de dolar. Vacios en los casos anteriores a esta migracion.
ALTER TABLE uif_reports
    ADD COLUMN IF NOT EXISTS mes DATE,
    ADD COLUMN IF NOT EXISTS salidas_mes_usd_minor BIGINT,
    ADD COLUMN IF NOT EXISTS entradas_mes_usd_minor BIGINT;

-- Un mes se cierra una sola vez: esta fila se escribe en la misma transaccion
-- que los casos del cierre.
CREATE TABLE IF NOT EXISTS uif_cierres (
    mes        DATE PRIMARY KEY,
    tasas      TEXT NOT NULL,
    clientes   INTEGER NOT NULL,
    casos      INTEGER NOT NULL,
    cerrado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
