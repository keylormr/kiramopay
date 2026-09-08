-- La bomba de tiempo de las particiones.
--
-- `transactions` esta particionada por rango sobre created_date (migracion 001)
-- y NO tiene particion DEFAULT: un INSERT cuya fecha no cae en ninguna particion
-- falla con "no partition of relation transactions found for row". Como cada
-- movimiento de dinero escribe una fila ahi, agotar las particiones no degrada
-- nada: detiene la aplicacion entera.
--
-- La migracion 001 creo particiones explicitas hasta 2027-01-01. La 014 dejo
-- `create_future_partitions()` (7 meses de margen) y la 023 dejo
-- `maintain_all_partitions()` con el comentario "Call this from CronJob". Ese
-- CronJob nunca existio: ninguna parte del backend llama a esas funciones. Solo
-- corrieron una vez, el dia que se aplico cada migracion.
--
-- Esta migracion hace tres cosas:
--   1. Amplia el margen de 7 a 14 meses, para que una corrida perdida no sea
--      fatal y el problema se vea con meses de anticipacion.
--   2. Agrega `transactions_partition_runway()`, que responde hasta que fecha
--      hay cobertura. El backend la publica en /health, para no volver a
--      depender de que alguien se acuerde de mirar.
--   3. Corre el mantenimiento ahora.
--
-- Deliberadamente NO se agrega una particion DEFAULT. Suena a red de seguridad y
-- es una trampa: en cuanto una fila aterriza ahi, crear la particion de ese mes
-- FALLA hasta que alguien mueva esa fila a mano. Cambiaria un fallo ruidoso y
-- con fecha conocida por uno silencioso que se descubre tarde. La red de
-- seguridad de verdad es el trabajo periodico mas la señal en /health.

CREATE OR REPLACE FUNCTION create_future_partitions()
RETURNS void AS $$
DECLARE
    partition_date DATE;
    partition_name TEXT;
BEGIN
    -- 14 meses de margen. Con el trabajo diario del backend basta uno, pero el
    -- margen es lo que sostiene el sistema si ese trabajo se cae sin que nadie
    -- lo note.
    FOR i IN 0..14 LOOP
        partition_date := date_trunc('month', CURRENT_DATE + (i || ' months')::INTERVAL);
        partition_name := 'transactions_' || to_char(partition_date, 'YYYY_MM');

        IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = partition_name) THEN
            EXECUTE format(
                'CREATE TABLE IF NOT EXISTS %I PARTITION OF transactions FOR VALUES FROM (%L) TO (%L)',
                partition_name,
                partition_date,
                partition_date + INTERVAL '1 month'
            );
            RAISE NOTICE 'Created partition: %', partition_name;
        END IF;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Hasta que fecha (exclusiva) hay cobertura continua de particiones de
-- transactions, empezando por el mes actual. Se corta en el primer hueco: dos
-- particiones separadas por un mes vacio no son cobertura, y devolver el maximo
-- absoluto seria mentir sobre el margen que queda.
CREATE OR REPLACE FUNCTION transactions_partition_runway()
RETURNS DATE AS $$
DECLARE
    cursor_date DATE := date_trunc('month', CURRENT_DATE)::DATE;
BEGIN
    LOOP
        EXIT WHEN NOT EXISTS (
            SELECT 1 FROM pg_class
             WHERE relname = 'transactions_' || to_char(cursor_date, 'YYYY_MM')
        );
        cursor_date := (cursor_date + INTERVAL '1 month')::DATE;
        -- Tope de seguridad: nadie tiene 500 años de particiones y un bucle
        -- infinito dentro de una migracion es peor que un numero raro.
        EXIT WHEN cursor_date > CURRENT_DATE + INTERVAL '500 years';
    END LOOP;
    RETURN cursor_date;
END;
$$ LANGUAGE plpgsql STABLE;

SELECT maintain_all_partitions();
