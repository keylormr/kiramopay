-- Normaliza cedulas guardadas con caracteres no numericos (guiones, espacios).
-- El login por identificador canonicaliza la cedula a solo digitos antes del
-- lookup por HMAC; una cedula hasheada CON guiones seria imposible de
-- encontrar. El frontend siempre armo cedulas de digitos puros, asi que esto
-- deberia tocar cero o poquisimas filas historicas, pero cierra el hueco.
-- Idempotente: la condicion deja de cumplirse tras la primera pasada.
UPDATE users
SET cedula_enc  = fn_pii_encrypt(regexp_replace(fn_pii_decrypt(cedula_enc), '\D', '', 'g')),
    cedula_hash = fn_pii_hmac(regexp_replace(fn_pii_decrypt(cedula_enc), '\D', '', 'g'))
WHERE fn_pii_decrypt(cedula_enc) ~ '\D';
