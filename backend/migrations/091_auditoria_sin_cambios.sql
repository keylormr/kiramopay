-- 091: el registro de auditoria no se edita ni se borra fila por fila.
--
-- Hasta aqui cualquier consulta con acceso a la base podia cambiar o borrar
-- una fila de audit_logs, y nada lo notaba. El registro existe para poder
-- reconstruir quien hizo que y cuando: una fila que se puede reescribir no
-- prueba nada. Mismo criterio que el libro contable (020, fn_journal_immutable),
-- con una excepcion.
--
-- La excepcion es la desasociacion de la eliminacion de cuenta
-- (accountdeletion/pasos.go, "desasociar auditoria"): por la Ley 8968 se
-- borran la IP, el navegador y los detalles del evento, y se conserva el resto
-- (quien, que, sobre que y cuando). Esa es la UNICA forma de UPDATE que se
-- acepta: todas las demas columnas iguales, ip_address y user_agent en NULL y
-- details vacio.
--
-- Borrar filas no se acepta nunca. Lo vencido (5 anos; 10 con un reporte de
-- operacion sospechosa o un requerimiento de autoridad) se purga quitando la
-- particion del mes entero, que no pasa por este disparador, y despues de que
-- ese mes quedo sellado fuera de la base (scripts/dr/sellar-auditoria.sh).
--
-- TRUNCATE tampoco pasa por un disparador de fila. Las pruebas lo usan para
-- limpiar; en produccion, un mes truncado no coincide con su sello.
--
-- Postgres acepta disparadores BEFORE de fila en una tabla particionada desde
-- la version 13, y los propaga a las particiones que existen y a las nuevas.

CREATE OR REPLACE FUNCTION fn_audit_logs_sin_cambios()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'audit_logs no se borra fila por fila: lo vencido se purga por particion'
            USING ERRCODE = 'restrict_violation';
    END IF;

    IF NEW.id            IS DISTINCT FROM OLD.id
    OR NEW.user_id       IS DISTINCT FROM OLD.user_id
    OR NEW.action        IS DISTINCT FROM OLD.action
    OR NEW.resource_type IS DISTINCT FROM OLD.resource_type
    OR NEW.resource_id   IS DISTINCT FROM OLD.resource_id
    OR NEW.risk_level    IS DISTINCT FROM OLD.risk_level
    OR NEW.created_at    IS DISTINCT FROM OLD.created_at
    OR NEW.created_date  IS DISTINCT FROM OLD.created_date
    OR NEW.ip_address    IS NOT NULL
    OR NEW.user_agent    IS NOT NULL
    OR NEW.details       IS DISTINCT FROM '{}'::jsonb
    THEN
        RAISE EXCEPTION 'audit_logs solo admite la desasociacion de una cuenta eliminada (ip, navegador y detalles en blanco)'
            USING ERRCODE = 'restrict_violation';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_logs_sin_cambios ON audit_logs;
CREATE TRIGGER trg_audit_logs_sin_cambios
    BEFORE UPDATE OR DELETE ON audit_logs
    FOR EACH ROW EXECUTE FUNCTION fn_audit_logs_sin_cambios();
