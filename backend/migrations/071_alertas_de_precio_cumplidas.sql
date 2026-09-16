-- Las alertas de precio se guardaban y nadie las evaluaba.
--
-- La tabla existe desde la 004 y el CRUD desde entonces, pero ningun proceso
-- comparaba las alertas activas contra el precio: una alerta creada no se
-- cumplia nunca. Desde esta migracion un barrido periodico (EvaluadorDeAlertas)
-- las evalua contra los precios que el servidor ya tiene en cache y avisa a la
-- persona.
--
-- Una alerta cumplida NO se borra: se marca. La fila queda con la fecha y el
-- precio con que se cumplio, que es lo que la pantalla muestra en "Cumplidas".
-- Quitarla de la lista tampoco la borra: se anota `borrada_at`.
--
-- Estados de una fila:
--   * activa:   active = true
--   * cumplida: active = false, cumplida_at no nulo, borrada_at nulo
--   * quitada:  borrada_at no nulo (sea que estuviera activa o cumplida)
-- Una fila inactiva sin cumplida_at ni borrada_at es una alerta que la persona
-- quito ANTES de esta migracion: no se sabe cuando, asi que no se inventa una
-- fecha. Ninguna lista la muestra.

ALTER TABLE crypto_price_alerts
    ADD COLUMN IF NOT EXISTS cumplida_at     TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS precio_cumplida NUMERIC(38, 18),
    ADD COLUMN IF NOT EXISTS borrada_at      TIMESTAMPTZ;

-- La fecha y el precio del cumplimiento van juntos, y una alerta cumplida ya no
-- esta activa: sin esto, un error del barrido podria dejarla disparable otra vez.
ALTER TABLE crypto_price_alerts DROP CONSTRAINT IF EXISTS chk_alert_cumplida;
ALTER TABLE crypto_price_alerts
    ADD CONSTRAINT chk_alert_cumplida
    CHECK ((cumplida_at IS NULL) = (precio_cumplida IS NULL)
           AND NOT (active AND cumplida_at IS NOT NULL));

-- Lo que el barrido recorre en cada vuelta: las activas de un activo, contra un
-- precio. Parcial para que las cumplidas y las quitadas no pesen.
CREATE INDEX IF NOT EXISTS idx_crypto_alerts_pendientes
    ON crypto_price_alerts (asset, direction, target_price)
    WHERE active = true;
