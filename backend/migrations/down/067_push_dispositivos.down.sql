-- Bajada de 067_push_dispositivos.sql
--
-- Se pierden los tokens registrados: cada telefono tiene que volver a activar
-- los avisos desde Perfil cuando la tabla vuelva.

DROP TABLE IF EXISTS push_dispositivos;
