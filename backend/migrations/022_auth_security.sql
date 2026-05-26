-- Migration 022: Refresh-token rotation, password-reset flow, MFA challenges
-- Phase: P0/P1 — Auth hardening
--
-- Design:
--  - refresh_tokens: family chain via parent_jti; reusing a consumed token
--    invalidates the entire family (detected via used_at IS NOT NULL).
--  - password_reset_tokens: single-use, short TTL, opaque hash.
--  - mfa_challenges: per-transaction high-value challenge gating posting.

BEGIN;

-- =========================================================================
-- 1. refresh_tokens
-- =========================================================================
CREATE TABLE IF NOT EXISTS refresh_tokens (
    jti          UUID PRIMARY KEY,
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    parent_jti   UUID REFERENCES refresh_tokens(jti) ON DELETE SET NULL,
    family_id    UUID NOT NULL,                  -- chain identifier
    token_hash   VARCHAR(128) NOT NULL,          -- sha-256 hex of the token
    issued_at    TIMESTAMP NOT NULL DEFAULT NOW(),
    expires_at   TIMESTAMP NOT NULL,
    used_at      TIMESTAMP,                       -- set when rotated
    revoked_at   TIMESTAMP,                       -- set on family revocation
    ip_address   INET,
    user_agent   TEXT,
    CONSTRAINT chk_refresh_expiry CHECK (expires_at > issued_at)
);

CREATE INDEX IF NOT EXISTS idx_refresh_user ON refresh_tokens (user_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_refresh_family ON refresh_tokens (family_id);
CREATE INDEX IF NOT EXISTS idx_refresh_active ON refresh_tokens (user_id)
    WHERE used_at IS NULL AND revoked_at IS NULL;

-- =========================================================================
-- 2. password_reset_tokens
-- =========================================================================
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash   VARCHAR(128) NOT NULL UNIQUE,    -- sha-256 hex
    requested_ip INET,
    expires_at   TIMESTAMP NOT NULL,
    used_at      TIMESTAMP,
    created_at   TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_pwr_expiry CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS idx_pwr_user ON password_reset_tokens (user_id, expires_at);

-- =========================================================================
-- 3. mfa_challenges
-- =========================================================================
CREATE TABLE IF NOT EXISTS mfa_challenges (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose         VARCHAR(32) NOT NULL,          -- 'high_value_tx','password_change','login_2fa'
    code_hash       VARCHAR(128) NOT NULL,         -- sha-256 of OTP/biometric assertion
    metadata        JSONB DEFAULT '{}',            -- e.g., tx_amount, tx_type
    attempts        INTEGER NOT NULL DEFAULT 0,
    max_attempts    INTEGER NOT NULL DEFAULT 3,
    verified_at     TIMESTAMP,
    expires_at      TIMESTAMP NOT NULL,
    created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_mfa_attempts CHECK (attempts >= 0 AND attempts <= max_attempts),
    CONSTRAINT chk_mfa_expiry CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS idx_mfa_user_purpose ON mfa_challenges (user_id, purpose, created_at DESC);

-- =========================================================================
-- 4. user_sessions: extend with access_jti, refresh_jti, fingerprint
-- =========================================================================
ALTER TABLE user_sessions
    ADD COLUMN IF NOT EXISTS access_jti     UUID,
    ADD COLUMN IF NOT EXISTS refresh_jti    UUID,
    ADD COLUMN IF NOT EXISTS device_fingerprint VARCHAR(128);

CREATE INDEX IF NOT EXISTS idx_sessions_refresh_jti ON user_sessions (refresh_jti)
    WHERE refresh_jti IS NOT NULL;

COMMIT;
