ALTER TABLE totp_recovery_codes DROP COLUMN IF EXISTS invalidated_at;
ALTER TABLE user_totp DROP COLUMN IF EXISTS disabled_at;
