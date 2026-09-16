-- Bajada de 068_planes_y_promocion.sql
--
-- Se pierden el plan de cada comercio, la fecha de su promocion y la marca de
-- primera aprobacion. Un comercio que estaba en promocion vuelve a pagar su
-- commission_bps completa desde el siguiente cobro.

ALTER TABLE qr_merchants DROP CONSTRAINT IF EXISTS chk_qr_merchants_plan;
ALTER TABLE qr_merchants
    DROP COLUMN IF EXISTS primera_aprobacion_at,
    DROP COLUMN IF EXISTS promo_hasta,
    DROP COLUMN IF EXISTS plan;

-- plan_interest vuelve a aceptar solo 'negocio' y 'cima' para filas NUEVAS.
-- Las filas de 'plus', 'pro' y 'analitica' NO se borran (quitar un plan no es
-- borrar registros): NOT VALID deja el CHECK sin revisar lo que ya existe.
ALTER TABLE plan_interest DROP CONSTRAINT IF EXISTS chk_plan_interest_plan;
ALTER TABLE plan_interest
    ADD CONSTRAINT chk_plan_interest_plan
    CHECK (plan IN ('negocio', 'cima')) NOT VALID;
