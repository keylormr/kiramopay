-- Migracion 082: la cuenta keilor (cedula 702650930) administra.
--
-- Decision del dueno (2026-10-19): keilor tiene que entrar al panel de
-- administracion. No hay ruta en la API para cambiar el rol de una cuenta, asi
-- que va como migracion, igual que la 026 promovio a admin.kp.
--
--   * El CHECK chk_users_demo_login_no_admin (058) no deja que un administrador
--     entre sin contrasena: keilor deja de ser cuenta de demostracion en la
--     misma sentencia. Entra con la contrasena que ya tenia.
--   * Se cierra todo lo que una sesion abierta tecleando solo "keilor" pudo
--     dejar, como en un bloqueo (blockAndRevoke):
--       - sesiones y refresh tokens: RequireAdmin lee el rol en cada peticion,
--         y sin esto heredarian el panel. IsAccessJTIRevoked lee user_sessions
--         en la siguiente peticion;
--       - llaves B2B (api_keys) y webhooks: no pasan por el panel, pero mueven
--         y reciben datos de la cuenta sin contrasena;
--       - suscripciones de avisos y telefonos: son credenciales de entrega, no
--         registros, y se destruyen como en el bloqueo. La persona reactiva los
--         avisos desde Perfil.
--   * El cambio de rol queda en audit_logs con cuanto se cerro de cada cosa.
--   * Por cedula_hash y NO por id, como la 058 y la 069. En una base recien
--     creada la cuenta no existe todavia (el sembrador corre despues de las
--     migraciones) y no pasa nada: el sembrador ya la crea administradora.
--   * Solo cierra y audita si la fila cambio: correrla otra vez no cierra
--     sesiones nuevas ni duplica la auditoria.
--
-- Todos los CTE corren completos y en el mismo snapshot aunque la consulta
-- final no lea todos; es una sola sentencia, asi que o pasa entera o nada.
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
    RETURNING 1
), sesiones AS (
    UPDATE user_sessions
       SET revoked_at = NOW()
     WHERE user_id IN (SELECT id FROM promovida)
       AND revoked_at IS NULL
    RETURNING 1
), llaves AS (
    UPDATE api_keys
       SET status = 'revoked', revoked_at = NOW()
     WHERE user_id IN (SELECT id FROM promovida)
       AND status = 'active'
    RETURNING 1
), ganchos AS (
    UPDATE webhook_endpoints
       SET status = 'disabled'
     WHERE user_id IN (SELECT id FROM promovida)
       AND status = 'active'
    RETURNING 1
), avisos AS (
    DELETE FROM push_subscriptions
     WHERE user_id IN (SELECT id FROM promovida)
    RETURNING 1
), telefonos AS (
    DELETE FROM push_dispositivos
     WHERE user_id IN (SELECT id FROM promovida)
    RETURNING 1
)
INSERT INTO audit_logs (user_id, action, resource_type, resource_id, details, risk_level)
SELECT id, 'role_granted', 'user', id::text,
       jsonb_build_object(
           'role', 'admin', 'migration', '082', 'demo_login', false,
           'sessions_revoked',           (SELECT COUNT(*) FROM sesiones),
           'refresh_tokens_revoked',     (SELECT COUNT(*) FROM renovaciones),
           'api_keys_revoked',           (SELECT COUNT(*) FROM llaves),
           'webhooks_disabled',          (SELECT COUNT(*) FROM ganchos),
           'push_subscriptions_removed', (SELECT COUNT(*) FROM avisos),
           'push_devices_removed',       (SELECT COUNT(*) FROM telefonos)),
       'high'
  FROM promovida;
