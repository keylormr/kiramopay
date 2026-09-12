-- Revierte la 063: vuelve a activar las tarjetas reemplazadas y cancela los
-- reemplazos. No borra filas en ninguno de los dos sentidos.
--
-- OJO: revertir vuelve a mostrar tarjetas rotuladas VISA, que es justo lo que
-- la 063 corrigio. Solo tiene sentido si la migracion hay que rehacerla. Y
-- cancela TODAS las tarjetas KiramoPay de quien tuvo una reemplazada, incluidas
-- las que haya creado despues: no hay marca que distinga un reemplazo de una
-- tarjeta nueva.

UPDATE virtual_cards
   SET status = 'cancelled'
 WHERE brand = 'kiramopay'
   AND user_id IN (SELECT user_id FROM virtual_cards WHERE status = 'replaced');

UPDATE virtual_cards
   SET status = CASE WHEN frozen_at IS NOT NULL THEN 'frozen' ELSE 'active' END
 WHERE status = 'replaced';
