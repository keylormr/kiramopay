-- Reactivar SOLO tiene sentido si ya existe el mecanismo que entrega el premio.
-- El stock ilimitado (-1) es el que traia la semilla para los que no lo tenian
-- acotado; los dos con stock finito se dejan en 0 a proposito: reponerlos es una
-- decision de negocio, no una reversion tecnica.
UPDATE loyalty_rewards SET active = TRUE, stock = -1
 WHERE name IN ('Cashback ₡500', 'Cashback ₡1,000', 'Cashback ₡2,500', 'Cashback ₡5,000',
                'SINPE gratis x5', 'SINPE gratis x10', 'Comision crypto 0%');
UPDATE loyalty_rewards SET active = TRUE WHERE name IN ('Recarga doble', 'Puntos dobles 24h');
