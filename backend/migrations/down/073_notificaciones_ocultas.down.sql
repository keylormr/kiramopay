-- Bajada de 073_notificaciones_ocultas.sql
--
-- Las notificaciones que la persona oculto vuelven a aparecer en su lista, y se
-- pierde el momento en que las oculto. Las filas no se tocan: nunca se
-- borraron.

DROP INDEX IF EXISTS idx_notif_user_visibles;
ALTER TABLE notification_history DROP COLUMN IF EXISTS hidden_at;
