-- Migration 034: convert every naive TIMESTAMP column to TIMESTAMPTZ.
-- Phase: G — Security/correctness hardening
--
-- Stored values are interpreted as UTC (production runs UTC). This closes a
-- latent bug: a `timestamp without time zone` column written with NOW() drops to
-- the server's local wall-clock and is read back by the app as UTC, skewing any
-- scheduling/expiry comparison when the DB server is not in UTC (observed in the
-- webhook retry backoff). Data-driven so it covers all tables without enumeration.
--
-- Partitioning-aware: only ordinary tables and partitioned PARENTS are altered
-- (the parent's ALTER cascades to its partitions). Partition children and their
-- inherited columns are skipped (cannot be altered directly), and each ALTER is
-- guarded so a partition-key column (which Postgres forbids altering) is skipped
-- gracefully instead of aborting the migration.
DO $$
DECLARE r RECORD;
BEGIN
	FOR r IN
		SELECT c.relname AS table_name, a.attname AS column_name
		FROM pg_attribute a
		JOIN pg_class c ON c.oid = a.attrelid
		JOIN pg_namespace n ON n.oid = c.relnamespace
		JOIN pg_type t ON t.oid = a.atttypid
		WHERE n.nspname = 'public'
			AND c.relkind IN ('r', 'p')   -- ordinary + partitioned parent tables
			AND NOT c.relispartition       -- skip partition children
			AND a.attnum > 0
			AND NOT a.attisdropped
			AND a.attinhcount = 0          -- skip inherited columns
			AND t.typname = 'timestamp'    -- timestamp without time zone
	LOOP
		BEGIN
			EXECUTE format(
				'ALTER TABLE public.%I ALTER COLUMN %I TYPE timestamptz USING %I AT TIME ZONE ''UTC''',
				r.table_name, r.column_name, r.column_name);
		EXCEPTION WHEN OTHERS THEN
			RAISE NOTICE 'timestamptz: skipped %.% (%)', r.table_name, r.column_name, SQLERRM;
		END;
	END LOOP;
END $$;
