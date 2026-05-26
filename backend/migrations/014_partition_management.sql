-- Automatic partition management for transactions table
-- Creates partitions 6 months ahead, idempotent (skips if exists)

CREATE OR REPLACE FUNCTION create_future_partitions()
RETURNS void AS $$
DECLARE
    partition_date DATE;
    partition_name TEXT;
    start_date DATE;
    end_date DATE;
BEGIN
    -- Create partitions for the next 6 months
    FOR i IN 0..6 LOOP
        partition_date := date_trunc('month', CURRENT_DATE + (i || ' months')::INTERVAL);
        partition_name := 'transactions_' || to_char(partition_date, 'YYYY_MM');
        start_date := partition_date;
        end_date := partition_date + INTERVAL '1 month';

        -- Check if partition already exists
        IF NOT EXISTS (
            SELECT 1 FROM pg_class WHERE relname = partition_name
        ) THEN
            EXECUTE format(
                'CREATE TABLE IF NOT EXISTS %I PARTITION OF transactions FOR VALUES FROM (%L) TO (%L)',
                partition_name,
                start_date,
                end_date
            );
            RAISE NOTICE 'Created partition: %', partition_name;
        END IF;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Run immediately
SELECT create_future_partitions();
