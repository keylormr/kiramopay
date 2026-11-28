-- Bajada de 092_avisos_con_destino.sql
--
-- Quita los datos para abrir la pantalla de cada aviso. El titulo y el cuerpo
-- no se tocan; tocar un aviso vuelve a solo marcarlo leido.
ALTER TABLE notification_history DROP COLUMN IF EXISTS datos;
