DROP INDEX IF EXISTS idx_users_expires_at;
ALTER TABLE users DROP COLUMN IF EXISTS expires_at;
