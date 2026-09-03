DROP INDEX IF EXISTS idx_users_blocked;
ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_blocked_coherente;
ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_blocked_reason_len;
UPDATE users SET status = 'active' WHERE status = 'blocked';
ALTER TABLE users DROP COLUMN IF EXISTS blocked_by;
ALTER TABLE users DROP COLUMN IF EXISTS blocked_reason;
ALTER TABLE users DROP COLUMN IF EXISTS blocked_at;
