-- Down migration for 028_mfa_totp.sql
BEGIN;
DROP TABLE IF EXISTS totp_recovery_codes;
DROP TABLE IF EXISTS user_totp;
COMMIT;
