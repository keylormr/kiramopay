BEGIN;
ALTER TABLE user_sessions
    DROP COLUMN IF EXISTS access_jti,
    DROP COLUMN IF EXISTS refresh_jti,
    DROP COLUMN IF EXISTS device_fingerprint;
DROP TABLE IF EXISTS mfa_challenges;
DROP TABLE IF EXISTS password_reset_tokens;
DROP TABLE IF EXISTS refresh_tokens;
COMMIT;
