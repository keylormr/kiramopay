-- Migration 028: TOTP (RFC 6238) authenticator-app MFA enrollment.
-- Phase: F — Moat / security hardening
--
-- Complements the existing per-transaction OTP challenge (mfa_challenges):
--   - user_totp:           one enrollment per user; the base32 secret is stored
--                          AES-256-GCM encrypted by the app layer (key derived
--                          from JWT_SECRET), never in plaintext.
--   - totp_recovery_codes: single-use backup codes (sha-256 hashed) so a user
--                          who loses their authenticator can still get in.
-- last_used_step is a monotonic replay guard: a TOTP code that maps to a step
-- <= last_used_step is rejected even within the validation window.
BEGIN;

CREATE TABLE IF NOT EXISTS user_totp (
    user_id        UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    secret_enc     BYTEA NOT NULL,             -- AES-256-GCM(nonce || ciphertext) of the base32 secret
    enabled        BOOLEAN NOT NULL DEFAULT FALSE,
    last_used_step BIGINT NOT NULL DEFAULT 0,  -- replay guard: reject steps <= this value
    confirmed_at   TIMESTAMP,
    created_at     TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS totp_recovery_codes (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash  VARCHAR(64) NOT NULL,           -- sha-256 hex of the recovery code
    used_at    TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- One row per (user, code); fast lookup of a user's unused codes.
CREATE UNIQUE INDEX IF NOT EXISTS uq_totp_recovery_hash
    ON totp_recovery_codes (user_id, code_hash);
CREATE INDEX IF NOT EXISTS idx_totp_recovery_unused
    ON totp_recovery_codes (user_id) WHERE used_at IS NULL;

COMMIT;
