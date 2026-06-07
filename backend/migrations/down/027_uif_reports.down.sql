-- Down migration for 027_uif_reports.sql
BEGIN;
DROP TABLE IF EXISTS uif_reports;
COMMIT;
