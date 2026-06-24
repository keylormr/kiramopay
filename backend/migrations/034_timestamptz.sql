-- Migration 034: convert every naive TIMESTAMP column to TIMESTAMPTZ.
-- Phase: G — Security/correctness hardening
--
-- Stored values are interpreted as UTC (production runs UTC). This closes a
-- latent bug: a `timestamp without time zone` column written with NOW() drops to
-- the server's local wall-clock and is read back by the app as UTC, skewing any
-- scheduling/expiry comparison when the DB server is not in UTC (observed in the
-- webhook retry backoff). Data-driven so it covers all tables without enumeration.
DO $$
DECLARE r RECORD;
BEGIN
	FOR r IN
		SELECT c.table_name, c.column_name
		FROM information_schema.columns c
		JOIN information_schema.tables t
			ON t.table_schema = c.table_schema AND t.table_name = c.table_name
		WHERE c.table_schema = 'public'
			AND t.table_type = 'BASE TABLE'
			AND c.data_type = 'timestamp without time zone'
	LOOP
		EXECUTE format(
			'ALTER TABLE public.%I ALTER COLUMN %I TYPE timestamptz USING %I AT TIME ZONE ''UTC''',
			r.table_name, r.column_name, r.column_name);
	END LOOP;
END $$;
