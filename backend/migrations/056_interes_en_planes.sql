-- Interes en los planes de pago (Kiramo Negocio y Kiramo Cima).
--
-- Hoy la aplicacion NO tiene forma de cobrar: no hay pasarela, no hay
-- suscripcion y no hay debito. Un boton que dijera "Suscribirse" seria una
-- promesa vacia, asi que lo que se registra aqui es exactamente lo que
-- ocurrio: alguien dijo que quiere el plan. Esta tabla es esa lista de
-- espera y nada mas — NO otorga el plan (eso vive en users.plan, cuyo CHECK
-- solo admite free/plus/pro) ni mueve un colon.
CREATE TABLE IF NOT EXISTS plan_interest (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plan       VARCHAR(16) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_plan_interest_plan CHECK (plan IN ('negocio', 'cima'))
);

-- Un usuario interesado dos veces en el mismo plan es UNA fila, no dos: el
-- upsert cae en este indice y solo refresca created_at. Sin el, tocar el
-- boton varias veces inflaria la lista y falsearia la demanda.
CREATE UNIQUE INDEX IF NOT EXISTS uq_plan_interest_user_plan
    ON plan_interest (user_id, plan);

-- La lista de administracion se lee siempre por fecha descendente.
CREATE INDEX IF NOT EXISTS idx_plan_interest_created
    ON plan_interest (created_at DESC);

COMMENT ON TABLE plan_interest IS
    'Interes registrado en un plan de pago. No es una suscripcion: no hay cobro asociado.';
