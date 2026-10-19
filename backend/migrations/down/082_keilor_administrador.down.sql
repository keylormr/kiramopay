-- Revierte la 082: keilor deja de administrar y vuelve a ser cuenta de
-- demostracion, como la dejo la 058. Lo que la 082 cerro (sesiones, llaves,
-- webhooks, avisos) no se reabre, y su fila de auditoria se conserva: quitar un
-- rol no borra su rastro. Quitarlo, y reabrir la entrada sin contrasena, deja
-- su propia fila.
WITH degradada AS (
    UPDATE users
       SET role       = 'user',
           demo_login = TRUE,
           updated_at = NOW()
     WHERE cedula_hash = fn_pii_hmac('702650930')
       AND deleted_at IS NULL
       AND role = 'admin'
    RETURNING id
)
INSERT INTO audit_logs (user_id, action, resource_type, resource_id, details, risk_level)
SELECT id, 'role_revoked', 'user', id::text,
       jsonb_build_object('role', 'admin', 'migration', '082', 'demo_login', true),
       'high'
  FROM degradada;
