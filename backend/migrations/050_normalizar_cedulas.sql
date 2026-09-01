-- Normaliza cedulas guardadas con caracteres no numericos (guiones, espacios).
-- El login por identificador canonicaliza la cedula a solo digitos antes del
-- lookup por HMAC; una cedula hasheada CON guiones seria imposible de
-- encontrar. El frontend siempre armo cedulas de digitos puros, asi que esto
-- deberia tocar cero o poquisimas filas historicas, pero cierra el hueco.
--
-- COLISION-SEGURA: solo normaliza la fila si su forma canonica NO colisiona
-- con el cedula_hash de OTRO usuario. El indice unico uq_users_cedula_hash es
-- no diferible, asi que sin este guard una colision (existe "3-0111-0555" y
-- "301110555" a la vez) abortaria el UPDATE y, con RUN_MIGRATIONS=true,
-- tumbaria el arranque. En caso de colision se deja la fila como esta (queda
-- accesible por telefono/correo) para que el deploy nunca falle; el caso es
-- teorico porque el registro siempre guardo digitos puros.
-- Idempotente: la condicion deja de cumplirse tras la primera pasada.
UPDATE users u
SET cedula_enc  = fn_pii_encrypt(regexp_replace(fn_pii_decrypt(u.cedula_enc), '\D', '', 'g')),
    cedula_hash = fn_pii_hmac(regexp_replace(fn_pii_decrypt(u.cedula_enc), '\D', '', 'g'))
WHERE fn_pii_decrypt(u.cedula_enc) ~ '\D'
  AND NOT EXISTS (
    SELECT 1 FROM users o
    WHERE o.id <> u.id
      AND o.cedula_hash = fn_pii_hmac(regexp_replace(fn_pii_decrypt(u.cedula_enc), '\D', '', 'g'))
  );
