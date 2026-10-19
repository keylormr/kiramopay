-- Migracion 082: la cuenta keilor (cedula 702650930) administra.
--
-- Decision del dueno (2026-10-19): keilor tiene que entrar al panel de
-- administracion. No hay ruta en la API para cambiar el rol de una cuenta, asi
-- que va como migracion, igual que la 026 promovio a admin.kp.
--
--   * El CHECK chk_users_demo_login_no_admin (058) no deja que un administrador
--     entre sin contrasena: keilor deja de ser cuenta de demostracion en la
--     misma sentencia. Entra con la contrasena que ya tenia.
--   * Se revocan sus sesiones abiertas. RequireAdmin lee el rol en cada
--     peticion, y sin esto una sesion abierta tecleando solo "keilor" heredaria
--     el panel. Son las mismas dos tablas que ChangePasswordAndRevokeSessions;
--     IsAccessJTIRevoked lee user_sessions en la siguiente peticion.
--   * El cambio de rol queda en audit_logs.
--   * Por cedula_hash y NO por id, como la 058 y la 069. En una base recien
--     creada la cuenta no existe todavia (el sembrador corre despues de las
--     migraciones) y no pasa nada: el sembrador ya la crea administradora.
--   * Solo revoca y audita si la fila cambio: correrla otra vez no cierra
--     sesiones nuevas ni duplica la auditoria.
WITH promovida AS (
    UPDATE users
       SET role       = 'admin',
           demo_login = FALSE,
           updated_at = NOW()
     WHERE cedula_hash = fn_pii_hmac('702650930')
       AND deleted_at IS NULL
       AND (role <> 'admin' OR demo_login)
    RETURNING id
), renovaciones AS (
    UPDATE refresh_tokens
       SET revoked_at = NOW()
     WHERE user_id IN (SELECT id FROM promovida)
       AND revoked_at IS NULL
), sesiones AS (
    UPDATE user_sessions
       SET revoked_at = NOW()
     WHERE user_id IN (SELECT id FROM promovida)
       AND revoked_at IS NULL
)
INSERT INTO audit_logs (user_id, action, resource_type, resource_id, details, risk_level)
SELECT id, 'role_granted', 'user', id::text,
       jsonb_build_object('role', 'admin', 'migration', '082',
                          'demo_login', false, 'sessions_revoked', true),
       'high'
  FROM promovida;
