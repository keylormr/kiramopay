-- Revierte la 069: las cinco cuentas de demostracion para terceros vuelven a
-- pedir contrasena. Los nombres de usuario se conservan (la persona pudo
-- haberlos usado) y la cuenta "demo" queda como la dejo la 058.
UPDATE users
   SET demo_login = FALSE
 WHERE cedula_hash IN (fn_pii_hmac('111111111'), fn_pii_hmac('222222222'), fn_pii_hmac('333333333'),
                       fn_pii_hmac('444444444'), fn_pii_hmac('555555555'))
   AND deleted_at IS NULL;
