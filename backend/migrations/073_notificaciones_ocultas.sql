-- Ocultar una notificacion, sin borrarla.
--
-- La pantalla ofrecia borrar cada notificacion y llamaba a una ruta que el
-- servidor no tenia: la quitaba de la lista, se tragaba el rechazo y la
-- notificacion volvia en la siguiente carga. Pedido del dueno: que la persona
-- deje de verla, pero que el registro quede. Quitar acceso no es borrar
-- registros: la fila se marca con el momento en que se oculto y nunca se
-- borra.

-- Con zona, como toda fecha desde la 034: sin zona, NOW() guarda la hora local
-- del servidor y la aplicacion la lee como UTC. La lista sigue usando
-- idx_notif_user (013); a este volumen no hace falta un indice propio para las
-- visibles.
ALTER TABLE notification_history ADD COLUMN IF NOT EXISTS hidden_at TIMESTAMPTZ;
