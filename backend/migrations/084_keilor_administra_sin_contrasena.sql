-- Migracion 084: keilor administra y entra sin contrasena.
--
-- Decision del dueno (2026-10-27), tomada sabiendo el riesgo: keilor (cedula
-- 702650930) sigue administrando y vuelve a entrar sin contrasena, como antes
-- de la 082. Con DEMO_LOGIN_ENABLED encendida, quien escriba "keilor" en la
-- pantalla de entrada abre el panel de administracion. Cada entrada asi queda
-- en audit_logs como login_demo con riesgo alto.
--
--   * El CHECK chk_users_demo_login_no_admin (058) se angosta en vez de
--     quitarse: la excepcion es solo el nombre de usuario keilor. admin.kp y
--     cualquier administrador futuro siguen sin poder entrar sin contrasena.
--     Va por username y no por cedula_hash porque fn_pii_hmac depende de la
--     llave y un CHECK no puede depender de nada fuera de la fila. El nombre de
--     usuario no cambia: ninguna ruta de la API lo escribe y es unico.
--   * COALESCE porque un CHECK que da NULL deja pasar la fila: sin el, un
--     administrador sin nombre de usuario quedaria fuera de la regla.
--   * La bandera del servidor sigue mandando: con DEMO_LOGIN_ENABLED apagada,
--     keilor pide contrasena como cualquiera.
--   * Como toda cuenta sin contrasena, keilor no cambia su correo ni su
--     contrasena, ni elimina su cuenta, ni cierra su propio comercio
--     (ErrCuentaDeDemostracion). El panel no pide contrasena para actuar.
--   * Por cedula_hash Y username, como la 082. En una base nueva la cuenta no
--     existe todavia y no pasa nada: el sembrador ya la crea asi. Solo audita
--     si la fila cambio: correrla otra vez no duplica la auditoria.

ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_demo_login_no_admin;
ALTER TABLE users ADD CONSTRAINT chk_users_demo_login_no_admin
    CHECK (NOT (demo_login AND role = 'admin') OR COALESCE(username, '') = 'keilor');

WITH abierta AS (
    UPDATE users
       SET demo_login = TRUE,
           updated_at = NOW()
     WHERE cedula_hash = fn_pii_hmac('702650930')
       AND username = 'keilor'
       AND deleted_at IS NULL
       AND NOT demo_login
    RETURNING id, role
)
INSERT INTO audit_logs (user_id, action, resource_type, resource_id, details, risk_level)
SELECT id, 'demo_login_enabled', 'user', id::text,
       jsonb_build_object('migration', '084', 'role', role, 'demo_login', true),
       'high'
  FROM abierta;
