-- Revierte la 082: keilor deja de administrar y vuelve a ser cuenta de
-- demostracion, como la dejo la 058. Las sesiones que la 082 revoco no se
-- reabren, y la fila de auditoria se conserva (quitar un rol no borra su
-- rastro).
UPDATE users
   SET role       = 'user',
       demo_login = TRUE,
       updated_at = NOW()
 WHERE cedula_hash = fn_pii_hmac('702650930')
   AND deleted_at IS NULL
   AND role = 'admin';
