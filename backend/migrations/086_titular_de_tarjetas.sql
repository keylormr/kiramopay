-- Migracion 086: el titular de las tarjetas ya emitidas.
--
-- El handler pasaba el literal "Titular KiramoPay" como titular de toda tarjeta
-- nueva (un TODO): la pantalla mostraba "TITULAR KIRAMOPAY" a todas las personas.
-- Desde ahora el titular es el nombre de la persona. Esta migracion corrige las
-- que ya salieron con el rotulo generico.
--
--   * Solo toca las tarjetas cuyo titular es exactamente el rotulo generico: un
--     titular distinto, escrito por quien sea, no se pisa.
--   * Usa el nombre y el apellido del perfil, sin espacios de mas y hasta los
--     200 caracteres que caben en la columna. Si el perfil no tiene nombre, la
--     tarjeta queda como esta: no se inventa uno.
--   * Es idempotente: una segunda pasada no encuentra tarjetas con el rotulo
--     generico y no hace nada.

UPDATE virtual_cards c
   SET cardholder_name = LEFT(
           TRIM(REGEXP_REPLACE(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, ''), '\s+', ' ', 'g')),
           200)
  FROM users u
 WHERE u.id = c.user_id
   AND c.cardholder_name = 'Titular KiramoPay'
   AND TRIM(REGEXP_REPLACE(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, ''), '\s+', ' ', 'g')) <> '';
