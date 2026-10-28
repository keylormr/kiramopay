-- Bajada de 085_actividad_de_sesion.sql
--
-- Se pierde la hora de la ultima accion de cada sesion. El cierre por
-- inactividad vuelve a medirse desde la emision del token de refresh.
ALTER TABLE user_sessions DROP COLUMN IF EXISTS last_activity_at;
