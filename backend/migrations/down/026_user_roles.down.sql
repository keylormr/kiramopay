-- Down migration for 026_user_roles.sql
BEGIN;
ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_user_role;
ALTER TABLE users DROP COLUMN IF EXISTS role;
COMMIT;
