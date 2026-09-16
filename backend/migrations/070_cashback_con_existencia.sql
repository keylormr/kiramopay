-- El catalogo de premios quedo vacio en produccion aunque el cashback estaba
-- activo.
--
-- La migracion 060 apago los premios con `active = FALSE, stock = 0`. La 066
-- volvio a encender los cashback (`active = TRUE`) pero no les devolvio la
-- existencia: los premios que ya existian desde la siembra de julio siguieron
-- con `stock = 0`. Y las dos puertas del catalogo miran la existencia:
--   * GetAvailableRewards solo lista `stock = -1 OR stock > 0`, asi que la
--     pantalla de premios aparecia vacia;
--   * RedeemReward rechaza `stock = 0` como agotado.
-- Verificado en la base de produccion el 2026-09-13: "Cashback ₡500" y
-- "Cashback ₡1,000" con `active = t` y `stock = 0`.
--
-- El cashback no tiene tope de unidades: lo que lo limita es el fondo de
-- promociones, que rechaza el canje cuando no alcanza. Por eso vuelve a
-- `stock = -1` (sin limite), igual que lo inserta la 066 cuando el premio no
-- existia.
--
-- Solo se tocan los premios que entregan algo (`cashback_minor` no nulo) y que
-- quedaron en cero. Los que no entregan nada siguen como estan (inactivos y en
-- cero), y un premio con una existencia positiva conserva el tope que alguien le
-- puso a proposito.
UPDATE loyalty_rewards
   SET stock = -1
 WHERE cashback_minor IS NOT NULL
   AND stock = 0;
