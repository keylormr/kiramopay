-- Los canjes que nadie honra.
--
-- Canjear un premio DESCUENTA los puntos, marca la redencion "completed" y
-- devuelve un codigo "KP-xxxxxxxxxxxx"... y ahi termina. Ese codigo se genera en
-- un solo lugar del backend y NO SE LEE EN NINGUNO: no hay abono a la
-- billetera, ni asiento en el libro, ni exoneracion de comision. La persona paga
-- sus puntos y no recibe nada.
--
-- Y los puntos no son de juguete: el bono de referido esta encendido por
-- defecto (REFERRAL_BONUS_POINTS=500) y acredita puntos por registros reales.
-- Quien invita a ocho personas junta 4.000 puntos y puede "comprar" un cashback
-- de 5.000 colones que nunca llega.
--
-- Es la misma politica que este repositorio ya aplico DOS veces:
--   * la migracion 047 desactivo "Nivel VIP 7 dias" con esta misma razon
--     escrita ("promising a temporary Gold tier that no code path actually
--     grants") — pero dejo activos los otros nueve, que tienen el mismo defecto;
--   * los cobros de recargas, recibos, viajes y pedidos se rechazan mientras no
--     haya convenio, porque debitar sin entregar es peor que decir que no.
--
-- Se desactivan, no se borran: las redenciones que ya existan conservan su
-- historial. Para reactivar uno hay que implementar su entrega primero — para
-- un cashback, un abono real con su asiento; para "SINPE gratis", un contador de
-- exoneraciones que el cobro de comision consulte.
--
-- Nota sobre "SINPE gratis": hoy promete descuento sobre una comision que NADIE
-- COBRA — el envio entre cuentas KiramoPay es gratis y el interbancario esta
-- dormido hasta que exista la licencia. Estaba vacio por partida doble.
UPDATE loyalty_rewards
   SET active = FALSE, stock = 0
 WHERE active = TRUE
   AND name IN (
       'Cashback ₡500',
       'Cashback ₡1,000',
       'Cashback ₡2,500',
       'Cashback ₡5,000',
       'SINPE gratis x5',
       'SINPE gratis x10',
       'Recarga doble',
       'Puntos dobles 24h',
       'Comision crypto 0%'
   );
