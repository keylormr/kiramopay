-- Una base nueva ya no trae un tipo de cambio del colon inventado.
--
-- La 043 sembraba USD/CRC en 515 con fuente 'manual', y con el los pares del
-- colon que salen de ese numero: el dolar al reves (1/515) y el balboa, atado
-- por ley 1:1 al dolar. En una base nueva eso quedaba vigente, como si alguien
-- lo hubiera confirmado, hasta la primera consulta a la fuente oficial. Con el
-- camino que cobra dando por bueno cualquier tipo de cambio de las ultimas 96
-- horas, cripto en colones se cotizaba esos dias con un 515 que nadie confirmo:
-- el oficial andaba por 450.
--
-- Son exactamente los cuatro pares que el actualizador escribe en cada pasada
-- (USD/CRC, CRC/USD, PAB/CRC, CRC/PAB). Sin la semilla, el par no existe hasta
-- que la fuente lo trae, y entre tanto el camino que cobra dice que no hay
-- tipo de cambio, que es la verdad.
--
-- Solo se borra la fila VIGENTE que sigue siendo la semilla: fuente 'manual' y
-- el valor exacto que puso la 043. Donde el actualizador ya escribio, la fila
-- vigente es de la fuente oficial y la semilla quedo cerrada como historia:
-- nada de eso se toca. Una tasa manual con otro valor es una decision de una
-- persona y tampoco se toca, ni se toca una que ya respalde una remesa.
--
-- Las tasas del quetzal (y USD/PAB, PAB/USD, que no dependen del colon) se
-- quedan: son manuales y no tienen otra fuente.

DELETE FROM exchange_rates e
 WHERE e.source = 'manual'
   AND e.effective_to IS NULL
   AND (e.from_currency, e.to_currency) IN (('USD', 'CRC'), ('CRC', 'USD'), ('PAB', 'CRC'), ('CRC', 'PAB'))
   AND e.rate IN (515.0, 0.00194)
   AND NOT EXISTS (SELECT 1 FROM cross_border_transfers x WHERE x.exchange_rate_id = e.id);
