-- Down migration for 031_b2b_hardening.sql
BEGIN;
ALTER TABLE api_keys DROP COLUMN IF EXISTS scopes;
COMMIT;
