-- 079_cierre_de_comercios.sql
--
-- El cierre de un comercio, sin borrarlo.
--
-- Hasta hoy un comercio no tenia salida: `active` existia desde la 007 pero
-- nada lo apagaba, y la lista del dueno traia todos. Pedido del dueno del
-- 2026-10-18: todo borrado es logico. Quitar acceso no es borrar registros, y
-- la Ley 7786 (art. 16) obliga a conservar las operaciones y la identidad de
-- quien las hizo por cinco anos: el comercio cerrado se queda con su cedula, su
-- razon social, sus ventas y su billetera (045), que ya no se podrian borrar de
-- todos modos (ledger_accounts lo referencia con ON DELETE RESTRICT).
--
-- Cerrar marca la fila:
--   closed_at       cuando se cerro;
--   closed_by       quien lo cerro: el dueno o un administrador (para la
--                   eliminacion de la cuenta, la persona que la pidio);
--   closure_reason  por que. El dueno no escribe uno: va 'owner_request'. Un
--                   administrador lo escribe siempre.
--
-- Con zona, como toda fecha desde la 034.
--
-- La eliminacion de cuenta (#279, migracion 077) tambien agrega closed_at:
-- por eso ADD COLUMN IF NOT EXISTS, que deja entrar las dos en cualquier
-- orden. Su CHECK (cerrado implica inactivo) es mas debil que el de aca y no
-- choca.

ALTER TABLE qr_merchants ADD COLUMN IF NOT EXISTS closed_at      TIMESTAMPTZ;
ALTER TABLE qr_merchants ADD COLUMN IF NOT EXISTS closed_by      UUID REFERENCES users(id);
ALTER TABLE qr_merchants ADD COLUMN IF NOT EXISTS closure_reason TEXT;

-- Si la 077 entro antes y su barrido ya cerro comercios, esas filas tienen
-- closed_at sin quien ni por que, y el CHECK de abajo no validaria: con
-- RUN_MIGRATIONS eso no deja arrancar la API. Las cerro la eliminacion de la
-- cuenta de su dueno, asi que se completan con eso. Sin la 077 no hay ninguna.
UPDATE qr_merchants
   SET closed_by = user_id, closure_reason = 'account_deletion', active = FALSE
 WHERE closed_at IS NOT NULL AND closed_by IS NULL;

-- Un cierre es entero o no es: o no hay ninguna de las tres marcas, o estan
-- las tres, con un motivo que dice algo y el comercio inactivo. `active` es
-- nullable desde la 007, y `active = FALSE` sobre un NULL da NULL, que un
-- CHECK deja pasar: por eso IS FALSE.
--
-- NOT VALID y despues VALIDATE, como la 077: el ALTER que agrega el CHECK solo
-- toma la tabla un instante, y la validacion la recorre sin frenar escrituras.
ALTER TABLE qr_merchants DROP CONSTRAINT IF EXISTS chk_qr_merchants_cierre;
ALTER TABLE qr_merchants ADD CONSTRAINT chk_qr_merchants_cierre CHECK (
    (closed_at IS NULL AND closed_by IS NULL AND closure_reason IS NULL)
    OR (closed_at IS NOT NULL AND closed_by IS NOT NULL AND active IS FALSE
        AND closure_reason IS NOT NULL AND btrim(closure_reason) <> '')
) NOT VALID;
ALTER TABLE qr_merchants VALIDATE CONSTRAINT chk_qr_merchants_cierre;

COMMENT ON COLUMN qr_merchants.closed_at IS
    'Cierre logico del comercio (079). Un comercio cerrado no cobra ni aparece en las listas del dueno ni del equipo; la fila no se borra nunca.';
COMMENT ON COLUMN qr_merchants.closure_reason IS
    'Motivo del cierre: owner_request cuando lo cerro su dueno, el texto del administrador cuando lo cerro uno.';
