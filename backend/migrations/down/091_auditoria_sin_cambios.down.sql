-- Bajada de 091_auditoria_sin_cambios.sql
--
-- Vuelve a permitir editar y borrar filas de audit_logs. No toca ningun dato.
DROP TRIGGER IF EXISTS trg_audit_logs_sin_cambios ON audit_logs;
DROP FUNCTION IF EXISTS fn_audit_logs_sin_cambios();
