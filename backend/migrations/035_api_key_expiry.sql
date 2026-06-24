-- Migration 035: API keys expire.
-- Phase: G — Security hardening
--
-- Before this, ResolveKey authenticated on status='active' alone, so a leaked
-- key was valid forever until manually revoked. New keys now get a default
-- expiry; existing active keys are backfilled with a generous one to bound the
-- blast radius of an undetected leak without breaking live integrations.
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

UPDATE api_keys
   SET expires_at = NOW() + INTERVAL '365 days'
 WHERE expires_at IS NULL AND status = 'active';
