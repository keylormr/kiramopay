-- Bajada de 074_idioma_de_la_cuenta.sql
--
-- Los avisos vuelven a salir en espanol para todos, y se pierde el idioma que
-- cada persona habia guardado.

ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_language;
ALTER TABLE users DROP COLUMN IF EXISTS language;
