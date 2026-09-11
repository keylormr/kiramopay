-- Los premios vuelven, pero solo los que se pueden entregar.
--
-- La migracion 060 desactivo los nueve premios porque canjear descontaba
-- puntos y devolvia un codigo que nadie leia. El dueno decidio el 2026-09-11
-- activar el CASHBACK con una cuenta de promociones que la empresa fondea: cada
-- canje sale de ahi y se rechaza si no alcanzan los fondos, asi nunca se regala
-- plata que no existe.
--
-- Contablemente, siguiendo lo que ya hace el libro:
--   * fondear:  debito SYSTEM:RESERVE:CRC     / credito SYSTEM:PROMOTIONS:CRC
--               (la empresa deposito plata para promociones: sube la reserva)
--   * canjear:  debito SYSTEM:PROMOTIONS:CRC  / credito la billetera
--               (la plata pasa a ser de la persona: sube el pasivo, respaldado
--               por la reserva que entro al fondear)

-- 1. La cuenta de promociones.
ALTER TABLE ledger_accounts DROP CONSTRAINT IF EXISTS chk_ledger_account_type;
ALTER TABLE ledger_accounts ADD CONSTRAINT chk_ledger_account_type CHECK (
    type IN ('user_wallet','system_fee','suspense','external','reserve','escrow','savings','merchant_wallet','promotions')
);

INSERT INTO ledger_accounts (code, type, currency, normal_balance, metadata) VALUES
    ('SYSTEM:PROMOTIONS:CRC', 'promotions', 'CRC', 'credit', '{"desc":"Fondo de promociones (cashback de puntos) CRC"}')
ON CONFLICT (code) DO NOTHING;

-- 2. Cuanto entrega cada premio. NULL = el premio no tiene como entregarse, y
--    el servicio se niega a canjearlo aunque alguien lo active a mano.
ALTER TABLE loyalty_rewards ADD COLUMN IF NOT EXISTS cashback_minor BIGINT;
ALTER TABLE loyalty_rewards DROP CONSTRAINT IF EXISTS chk_loyalty_cashback_positivo;
ALTER TABLE loyalty_rewards ADD CONSTRAINT chk_loyalty_cashback_positivo
    CHECK (cashback_minor IS NULL OR cashback_minor > 0);

-- 3. Los cuatro cashback, activos y con su monto. Se crean si no existen: el
--    catalogo lo sembraba el sembrador de desarrollo, y una base que no paso
--    por el quedaria sin premios y sin avisar.
INSERT INTO loyalty_rewards (name, description, category, points_cost, stock, active, cashback_minor)
SELECT v.nombre, v.descripcion, 'discount', v.puntos, -1, TRUE, v.monto
  FROM (VALUES
        ('Cashback ₡500',   '₡500 de vuelta a tu cuenta CRC',   500::bigint,  50000::bigint),
        ('Cashback ₡1,000', '₡1,000 de vuelta a tu cuenta CRC', 900::bigint,  100000::bigint),
        ('Cashback ₡2,500', '₡2,500 de vuelta a tu cuenta CRC', 2000::bigint, 250000::bigint),
        ('Cashback ₡5,000', '₡5,000 de vuelta a tu cuenta CRC', 3800::bigint, 500000::bigint)
       ) AS v(nombre, descripcion, puntos, monto)
 WHERE NOT EXISTS (SELECT 1 FROM loyalty_rewards r WHERE r.name = v.nombre);

UPDATE loyalty_rewards SET cashback_minor = 50000,  active = TRUE WHERE name = 'Cashback ₡500';
UPDATE loyalty_rewards SET cashback_minor = 100000, active = TRUE WHERE name = 'Cashback ₡1,000';
UPDATE loyalty_rewards SET cashback_minor = 250000, active = TRUE WHERE name = 'Cashback ₡2,500';
UPDATE loyalty_rewards SET cashback_minor = 500000, active = TRUE WHERE name = 'Cashback ₡5,000';

-- 4. Todo premio sin entrega queda inactivo: los cinco que no entregan nada
--    (SINPE gratis y comision cripto 0 % descuentan comisiones que no se
--    cobran, recarga doble depende de recargas apagadas, puntos dobles no sirve
--    porque nada acumula puntos) y cualquier otro que alguien haya sembrado.
--    Se marcan, no se borran: sus canjes viejos los referencian.
UPDATE loyalty_rewards SET active = FALSE WHERE cashback_minor IS NULL AND active = TRUE;
