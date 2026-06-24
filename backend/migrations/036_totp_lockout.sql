-- Migration 036: brute-force lockout for TOTP / recovery-code verification.
-- Phase: G — Security hardening
--
-- VerifyTOTP had no failure counter or lockout (unlike the OTP path), leaving a
-- standing online-guessing channel against the second factor. These columns let
-- the service count consecutive failures and temporarily lock verification.
ALTER TABLE user_totp ADD COLUMN IF NOT EXISTS failed_attempts INT NOT NULL DEFAULT 0;
ALTER TABLE user_totp ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;
