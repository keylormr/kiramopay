-- Bajada de 085_actividad_de_sesion.sql
--
-- Se pierde la hora de la ultima accion de cada sesion (el cierre por
-- inactividad vuelve a medirse desde la emision del token de refresh) y el
-- motivo con que el servidor cerro cada sesion o refresh token.
--
-- Las sesiones que la subida cerro por tener su refresh token revocado quedan
-- cerradas: reabrirlas mostraria otra vez como abiertas sesiones que no
-- pueden servir.
ALTER TABLE refresh_tokens DROP COLUMN IF EXISTS revoked_reason;
ALTER TABLE user_sessions DROP COLUMN IF EXISTS revoked_reason;
ALTER TABLE user_sessions DROP COLUMN IF EXISTS last_activity_at;
