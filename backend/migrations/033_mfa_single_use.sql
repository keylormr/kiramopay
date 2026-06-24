-- Migration 033: single-use high-value MFA verifications.
-- Phase: G — Security hardening
--
-- Before this change the high-value money gate (HasVerifiedMFA) was a pure
-- time-window read: one verified challenge for (user, 'high_value_tx')
-- authorized an UNLIMITED number of high-value transfers/escrow fundings/payouts
-- until it expired (~5 min). consumed_at lets the gate atomically claim exactly
-- one verification per money movement, so a single TOTP verification authorizes
-- a single high-value action.
ALTER TABLE mfa_challenges ADD COLUMN IF NOT EXISTS consumed_at TIMESTAMPTZ;

-- Speeds up the gate's "latest unconsumed, verified, in-window" lookup.
CREATE INDEX IF NOT EXISTS idx_mfa_challenges_gate
	ON mfa_challenges (user_id, purpose, verified_at DESC)
	WHERE verified_at IS NOT NULL AND consumed_at IS NULL;
