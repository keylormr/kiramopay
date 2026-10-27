-- Revierte la 084: keilor sigue administrando pero vuelve a pedir contrasena, y
-- el CHECK vuelve a ser el de la 058 (ningun administrador sin contrasena).
--
-- Cierra lo que una sesion abierta tecleando solo "keilor" pudo dejar, igual
-- que la 082: sesiones y refresh tokens (el rol se lee en cada peticion y sin
-- esto seguirian en el panel), llaves B2B, webhooks y suscripciones de avisos.
-- La marca se apaga ANTES de restaurar el CHECK: al reves, el ADD CONSTRAINT
-- fallaria contra la fila de keilor.
WITH cerrada AS (
    UPDATE users
       SET demo_login = FALSE,
           updated_at = NOW()
     WHERE cedula_hash = fn_pii_hmac('702650930')
       AND deleted_at IS NULL
       AND demo_login
       AND role = 'admin'
    RETURNING id
), renovaciones AS (
    UPDATE refresh_tokens
       SET revoked_at = NOW()
     WHERE user_id IN (SELECT id FROM cerrada)
       AND revoked_at IS NULL
    RETURNING 1
), sesiones AS (
    UPDATE user_sessions
       SET revoked_at = NOW()
     WHERE user_id IN (SELECT id FROM cerrada)
       AND revoked_at IS NULL
    RETURNING 1
), llaves AS (
    UPDATE api_keys
       SET status = 'revoked', revoked_at = NOW()
     WHERE user_id IN (SELECT id FROM cerrada)
       AND status = 'active'
    RETURNING 1
), ganchos AS (
    UPDATE webhook_endpoints
       SET status = 'disabled'
     WHERE user_id IN (SELECT id FROM cerrada)
       AND status = 'active'
    RETURNING 1
), avisos AS (
    DELETE FROM push_subscriptions
     WHERE user_id IN (SELECT id FROM cerrada)
    RETURNING 1
), telefonos AS (
    DELETE FROM push_dispositivos
     WHERE user_id IN (SELECT id FROM cerrada)
    RETURNING 1
)
INSERT INTO audit_logs (user_id, action, resource_type, resource_id, details, risk_level)
SELECT id, 'demo_login_disabled', 'user', id::text,
       jsonb_build_object(
           'migration', '084', 'role', 'admin', 'demo_login', false,
           'sessions_revoked',           (SELECT COUNT(*) FROM sesiones),
           'refresh_tokens_revoked',     (SELECT COUNT(*) FROM renovaciones),
           'api_keys_revoked',           (SELECT COUNT(*) FROM llaves),
           'webhooks_disabled',          (SELECT COUNT(*) FROM ganchos),
           'push_subscriptions_removed', (SELECT COUNT(*) FROM avisos),
           'push_devices_removed',       (SELECT COUNT(*) FROM telefonos)),
       'high'
  FROM cerrada;

ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_demo_login_no_admin;
ALTER TABLE users ADD CONSTRAINT chk_users_demo_login_no_admin
    CHECK (NOT (demo_login AND role = 'admin'));
