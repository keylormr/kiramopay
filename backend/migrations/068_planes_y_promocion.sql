-- Planes personales, plan de comercio y promocion de entrada (13-09-2026).
--
-- Tres cambios que salen de la misma decision del dueno:
--
--   1. plan_interest deja de recibir 'negocio' y 'cima' (esos planes se
--      retiraron: prometian umbrales y beneficios que no existian) y pasa a
--      recibir 'plus', 'pro' y 'analitica'. Las filas viejas NO se borran: el
--      CHECK las sigue admitiendo para que la lista de espera conserve lo que
--      la gente pidio en su momento. Que el POST ya no acepte los dos planes
--      viejos lo decide la aplicacion, no la base.
--
--   2. qr_merchants.plan: 'base' (lo que tiene todo comercio) o 'analitica'
--      (comparacion del reporte contra el periodo anterior y exportacion).
--      Mientras no exista cobro, solo un administrador lo cambia.
--
--   3. Promocion de entrada: un comercio NUEVO paga 0,25 % durante sus primeros
--      3 meses desde que su verificacion se aprueba; despues, su comision
--      normal. Si un administrador le fijo una comision menor, se respeta la
--      menor. `promo_hasta` es la fecha en que termina; NULL = nunca tuvo.
--
-- Los dos CHECK se validan en esta misma transaccion, sin el NOT VALID +
-- VALIDATE separado que pide ZERO_DOWNTIME_MIGRATIONS.md para tablas grandes:
-- plan_interest y qr_merchants tienen decenas de filas, el escaneo dura
-- milisegundos y el lock_timeout del runner corta si no consigue el bloqueo.
--
-- primera_aprobacion_at existe para que la promocion se otorgue UNA sola vez.
-- Sin ella, un comercio que ya estaba aprobado y cambia su cedula (vuelve a
-- 'pending', ver UpdateMerchant) recibiria la promocion al re-aprobarse, y la
-- decision es que los comercios aprobados antes del despliegue no la reciben.

ALTER TABLE plan_interest DROP CONSTRAINT IF EXISTS chk_plan_interest_plan;
ALTER TABLE plan_interest
    ADD CONSTRAINT chk_plan_interest_plan
    CHECK (plan IN ('plus', 'pro', 'analitica', 'negocio', 'cima'));

ALTER TABLE qr_merchants
    ADD COLUMN IF NOT EXISTS plan                  VARCHAR(16) NOT NULL DEFAULT 'base',
    ADD COLUMN IF NOT EXISTS promo_hasta           TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS primera_aprobacion_at TIMESTAMPTZ;

ALTER TABLE qr_merchants DROP CONSTRAINT IF EXISTS chk_qr_merchants_plan;
ALTER TABLE qr_merchants
    ADD CONSTRAINT chk_qr_merchants_plan CHECK (plan IN ('base', 'analitica'));

-- Quien ya fue aprobado antes de este despliegue queda marcado, y por eso no
-- recibe la promocion aunque vuelva a aprobarse. "Ya fue aprobado" no se puede
-- leer solo de verification_status: un comercio aprobado que cambio su cedula
-- esta hoy en 'pending'. Pero nadie cobra sin estar verificado — emitir un
-- codigo de comercio, un cobro o recibir un pago lo exigen —, asi que haber
-- dejado cualquiera de esas huellas prueba que estuvo aprobado.
UPDATE qr_merchants m
   SET primera_aprobacion_at = COALESCE(m.reviewed_at, m.created_at, NOW())
 WHERE m.primera_aprobacion_at IS NULL
   AND (m.verification_status = 'verified'
        OR EXISTS (SELECT 1 FROM qr_payments p      WHERE p.merchant_id = m.id)
        OR EXISTS (SELECT 1 FROM qr_payment_codes c WHERE c.merchant_id = m.id)
        OR EXISTS (SELECT 1 FROM qr_charges ch      WHERE ch.merchant_id = m.id));

COMMENT ON COLUMN qr_merchants.promo_hasta IS
    'Fin de la promocion de entrada (0,25 % o la comision fijada si es menor). NULL = el comercio nunca la tuvo.';
COMMENT ON COLUMN qr_merchants.primera_aprobacion_at IS
    'Primera vez que se aprobo la verificacion. La promocion solo se otorga en esa aprobacion.';
