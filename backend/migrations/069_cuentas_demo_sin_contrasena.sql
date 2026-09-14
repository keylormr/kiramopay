-- Todas las cuentas de demostracion entran sin contrasena.
--
-- Decision del dueno (2026-09-05, reiterada el 2026-09-13): las cuentas de
-- demostracion se abren solo con el nombre de usuario (o la cedula), sin
-- contrasena, mientras DEMO_LOGIN_ENABLED este encendida en el servidor. La
-- migracion 058 marco keilor, demo, victor y emmanuel, pero dejo afuera las
-- cinco cuentas creadas el 2026-09-01 para demostrar a terceros (Ana, Bruno,
-- Carla, Diego y Elena Demo). Esta migracion las marca y les da un nombre de
-- usuario corto para teclear.
--
-- Mismas reglas que la 058:
--   * por cedula_hash y NO por id, para que funcione en cualquier base;
--   * nunca una cuenta de administrador (el CHECK chk_users_demo_login_no_admin
--     lo prohibe; la guarda de rol evita que una fila rara aborte el arranque
--     con RUN_MIGRATIONS=true);
--   * si el nombre de usuario ya esta tomado se conserva el que tenga la cuenta
--     y se marca igual, porque entrar por cedula tambien funciona.
DO $$
DECLARE
    par      RECORD;
    marcadas INT := 0;
BEGIN
    FOR par IN
        SELECT * FROM (VALUES
            ('111111111', 'ana'),
            ('222222222', 'bruno'),
            ('333333333', 'carla'),
            ('444444444', 'diego'),
            ('555555555', 'elena'),
            ('701234567', 'demo')
        ) AS t(cedula, nombre)
    LOOP
        UPDATE users
           SET demo_login = TRUE
         WHERE cedula_hash = fn_pii_hmac(par.cedula)
           AND COALESCE(role, '') <> 'admin'
           AND deleted_at IS NULL;
        IF FOUND THEN
            marcadas := marcadas + 1;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM users WHERE username = par.nombre) THEN
            UPDATE users
               SET username = par.nombre
             WHERE cedula_hash = fn_pii_hmac(par.cedula)
               AND COALESCE(role, '') <> 'admin'
               AND username IS NULL
               AND deleted_at IS NULL;
        END IF;
    END LOOP;
    RAISE NOTICE 'cuentas de demostracion marcadas para entrar sin contrasena: %', marcadas;
END $$;
