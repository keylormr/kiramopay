-- Migration 031: B2B hardening — per-key scopes.
-- Phase: F — Moat / product (merchant integrations)
--
-- api_keys.scopes is a comma-separated allowlist consumed by the merchant-API
-- middleware (today: escrow:read, escrow:write). Keys created before this
-- migration keep full access. Webhook secrets are now stored encrypted
-- (AES-256-GCM, app-layer, "enc:" prefix) — no schema change needed, the TEXT
-- column holds either form and the code reads both.
BEGIN;

ALTER TABLE api_keys
    ADD COLUMN IF NOT EXISTS scopes TEXT NOT NULL DEFAULT 'escrow:read,escrow:write';

-- Encrypted secrets ('enc:' + base64(nonce||ciphertext||tag)) are ~116 chars,
-- larger than the original VARCHAR(64).
ALTER TABLE webhook_endpoints
    ALTER COLUMN secret TYPE TEXT;

COMMIT;
