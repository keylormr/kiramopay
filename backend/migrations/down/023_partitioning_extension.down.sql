BEGIN;
-- This is destructive; only run in dev. We collapse back to a plain table.
DROP FUNCTION IF EXISTS maintain_all_partitions();
DROP TABLE IF EXISTS sinpe_history CASCADE;
ALTER TABLE IF EXISTS sinpe_history_archive RENAME TO sinpe_history;
DROP FUNCTION IF EXISTS create_monthly_partitions(TEXT, INTEGER, INTEGER);
COMMIT;
