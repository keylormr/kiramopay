-- Las tarjetas virtuales imprimian el numero de otra persona.
--
-- generateCardNumber armaba 16 digitos que empezaban en 4 con el digito
-- verificador de Luhn correcto: un numero VISA sintacticamente valido, que
-- puede coincidir con la tarjeta de alguien real ajeno a la aplicacion. El
-- dueno decidio el 2026-09-11 que la tarjeta es DECORATIVA: desde ahora el
-- numero empieza en 8 (ninguna red de pago) y falla Luhn a proposito, y la
-- marca es "kiramopay".
--
-- Esta migracion se ocupa de las ya emitidas. El numero completo nunca se
-- guardo —la base solo tiene el enmascarado y los ultimos cuatro—, asi que no
-- hay un PAN que borrar aca. Lo que queda es:
--
--   1. Emitir un REEMPLAZO por cada tarjeta VISA viva, para la misma persona,
--      con el mismo estado (una congelada sigue congelada) y los mismos topes.
--      Los ultimos cuatro son nuevos y al azar: es una tarjeta distinta.
--   2. Marcar la vieja como 'replaced'. NO se borra: sus movimientos
--      (card_transactions) la referencian y el registro se conserva, que es
--      la regla del repositorio para quitar acceso.
--
-- El orden importa: el reemplazo se inserta primero con marca 'kiramopay', asi
-- que el UPDATE de abajo no lo toca. Las canceladas quedan como estan.
--
-- Es idempotente: una segunda pasada no encuentra tarjetas vivas que no sean
-- de KiramoPay y no hace nada.

INSERT INTO virtual_cards (
    user_id, card_number, last4, expiry_month, expiry_year, cardholder_name,
    brand, type, currency, status, daily_limit, monthly_limit, atm_limit, frozen_at
)
SELECT v.user_id,
       '•••• •••• •••• ' || v.l4,
       v.l4,
       EXTRACT(MONTH FROM NOW())::int,
       EXTRACT(YEAR FROM NOW())::int + 3,
       v.cardholder_name,
       'kiramopay',
       v.type,
       v.currency,
       v.status,
       v.daily_limit,
       v.monthly_limit,
       v.atm_limit,
       v.frozen_at
  FROM (
        SELECT c.*, lpad(floor(random() * 10000)::int::text, 4, '0') AS l4
          FROM virtual_cards c
         WHERE c.brand IS DISTINCT FROM 'kiramopay'
           AND c.status IN ('active', 'frozen')
       ) v;

UPDATE virtual_cards
   SET status = 'replaced'
 WHERE brand IS DISTINCT FROM 'kiramopay'
   AND status IN ('active', 'frozen');
