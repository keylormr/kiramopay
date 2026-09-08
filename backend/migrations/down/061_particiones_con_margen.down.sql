-- Volver al margen de 7 meses no tiene ningun sentido operativo: las
-- particiones que esta migracion creo se quedan, y quitarlas borraria datos.
-- Lo unico reversible es la funcion de consulta.
DROP FUNCTION IF EXISTS transactions_partition_runway();
