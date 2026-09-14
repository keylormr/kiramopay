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
-- o su razon social esta hoy en 'pending', y ese cambio (UpdateMerchantProfile)
-- no deja un rastro propio. Se marca a quien muestre cualquiera de estas
-- senales:
--
--   a. Nacio antes de que se aplicara la 038. Esa migracion dio por verificados
--      a todos los comercios que existian, sin llenar reviewed_at, y cualquiera
--      de ellos que despues edito su perfil volvio a 'pending': su cedula estaba
--      vacia, asi que llenarla cuenta como cambio de identidad. La fecha sale de
--      schema_migrations, que crea el runner (RUN_MIGRATIONS). Donde las
--      migraciones corren sin el (el initdb de docker-compose, sobre una base
--      vacia) esa tabla no existe ni hay comercios viejos: de ahi el IF.
--   b. Esta verificado hoy.
--   c. Conserva la revision de un administrador (reviewed_at). Cubre al que fue
--      aprobado y cambio su identidad antes de cobrar nada, si ese cambio es
--      anterior al 13-09-2026: hasta entonces volver a 'pending' conservaba
--      reviewed_at.
--   d. Dejo huella de cobro: emitir un codigo de comercio, un cobro o recibir un
--      pago exigen estar verificado.
--
-- Costo aceptado de (c): reviewed_at tambien se llena al RECHAZAR, y nada
-- distingue "rechazado y nunca aprobado" de "aprobado, cambio su identidad y
-- despues rechazado". Un comercio que llega a este despliegue rechazado, o en
-- 'pending' con la revision de un rechazo, tampoco recibira la promocion cuando
-- se apruebe. Se prefiere ese error, que cobra 0,5 % a quien pudo pagar 0,25 %,
-- al contrario, que regala la promocion a un comercio que ya estaba aprobado.
--
-- Lo que ninguna senal reconoce. Desde el 13-09-2026, volver a 'pending' limpia
-- reviewed_at y reviewed_by (UpdateMerchantProfile): esa revision era de los
-- datos anteriores. Un comercio que se aprobo, nacio despues de la 038, nunca
-- emitio un codigo ni cobro, y cambio su identidad entre ese despliegue y esta
-- migracion queda igual que uno que nunca se reviso: 'pending', sin reviewed_at
-- y sin huella. Igual queda el aprobado, rechazado y corregido en esa ventana.
-- No hay dato en la base que los distinga, asi que esta migracion los trata
-- como nuevos y reciben la promocion al aprobarse. Lo unico que los separa es
-- el registro de peticiones del servidor (POST /api/v1/admin/merchants/{id}/approve
-- con estado 200). Los candidatos se revisan a mano antes de desplegar: los
-- comercios en 'pending' sin reviewed_at, sin huella de cobro y nacidos despues
-- de la 038.
--
-- El hueco no se repite despues de esta migracion: la marca deja de depender de
-- reviewed_at. UpdateVerification la fija en la primera aprobacion, nada la
-- limpia, y UpdateVerification y UpdateMerchantProfile se la dejan a toda fila
-- 'verified' que toquen y no la tenga (la que aprueba la version anterior
-- mientras arranca la nueva).
--
-- (a) va primero para que esos comercios queden con la fecha en que la 038 los
-- aprobo y no con la de su ultima revision. created_at es TIMESTAMP sin zona:
-- la comparacion usa la zona de la sesion, la misma con la que la app lo
-- escribio.
DO $$
BEGIN
    IF to_regclass('schema_migrations') IS NOT NULL THEN
        UPDATE qr_merchants m
           SET primera_aprobacion_at = s.applied_at
          FROM schema_migrations s
         WHERE s.filename = '038_merchant_multi_kyc_commission.sql'
           AND m.primera_aprobacion_at IS NULL
           AND m.created_at < s.applied_at;
    END IF;
END $$;

UPDATE qr_merchants m
   SET primera_aprobacion_at = COALESCE(m.reviewed_at, m.created_at, NOW())
 WHERE m.primera_aprobacion_at IS NULL
   AND (m.verification_status = 'verified'
        OR m.reviewed_at IS NOT NULL
        OR EXISTS (SELECT 1 FROM qr_payments p      WHERE p.merchant_id = m.id)
        OR EXISTS (SELECT 1 FROM qr_payment_codes c WHERE c.merchant_id = m.id)
        OR EXISTS (SELECT 1 FROM qr_charges ch      WHERE ch.merchant_id = m.id));

COMMENT ON COLUMN qr_merchants.promo_hasta IS
    'Fin de la promocion de entrada (0,25 % o la comision fijada si es menor). NULL = el comercio nunca la tuvo.';
COMMENT ON COLUMN qr_merchants.primera_aprobacion_at IS
    'Primera vez que se aprobo la verificacion. La promocion solo se otorga en esa aprobacion.';
