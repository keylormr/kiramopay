-- Ocultar una notificacion, sin borrarla.
--
-- La pantalla ofrecia borrar cada notificacion y llamaba a una ruta que el
-- servidor no tenia: la quitaba de la lista, se tragaba el rechazo y la
-- notificacion volvia en la siguiente carga. Pedido del dueno: que la persona
-- deje de verla, pero que el registro quede. Quitar acceso no es borrar
-- registros: la fila se marca con el momento en que se oculto y nunca se
-- borra.

ALTER TABLE notification_history ADD COLUMN IF NOT EXISTS hidden_at TIMESTAMP;

-- La lista que ve la persona solo lee las que no oculto.
CREATE INDEX IF NOT EXISTS idx_notif_user_visibles
    ON notification_history (user_id, created_at DESC)
    WHERE hidden_at IS NULL;
