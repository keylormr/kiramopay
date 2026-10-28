-- Bajada de 089_apertura_de_la_reserva.sql
--
-- No hay nada que revertir: el libro es de solo agregar, y el asiento de
-- apertura no se borra (ni se contra-asienta aca: devolver la reserva a un
-- descuadre que ya se corrigio seria reintroducirlo). Si hiciera falta
-- deshacerlo, se hace con un asiento nuevo que decida el dueno. Se deja como
-- no-op a proposito.
SELECT 1;
