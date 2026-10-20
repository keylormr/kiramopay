-- Bajada de 083_respuestas_de_eliminacion.sql
--
-- Se pierde la constancia de cada respuesta escrita (cuando salio, por que via
-- y quien la entrego a mano). La solicitud y su auditoria siguen en users y en
-- audit_logs.
DROP TABLE IF EXISTS account_deletion_responses;
