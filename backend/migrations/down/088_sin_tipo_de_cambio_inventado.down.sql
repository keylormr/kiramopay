-- Bajada de 088_sin_tipo_de_cambio_inventado.sql
--
-- No hay nada que revertir: la migracion quito una semilla de 515 que nadie
-- confirmo, y devolverla seria reintroducir un tipo de cambio inventado. Se
-- deja como no-op a proposito; el actualizador escribe los cuatro pares en la
-- primera pasada.
SELECT 1;
