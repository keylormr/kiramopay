-- Migration 030: B2B API platform — API keys + webhooks.
-- Phase: F — Moat / product (merchant integrations)
--
--  - api_keys: bearer credentials for the merchant API (/api/b2b/v1/*). Only
--    a sha-256 hash is stored; the full key is shown once at creation. The
--    prefix column keeps the first characters for display/identification.
--  - webhook_endpoints: merchant-registered URLs notified of events (escrow
--    lifecycle for now). Deliveries are HMAC-SHA256 signed with the endpoint
--    secret.
--  - webhook_deliveries: the outbox — a background dispatcher posts pending
--    rows with exponential backoff and records the outcome.
BEGIN;

CREATE TABLE IF NOT EXISTS api_keys (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name         VARCHAR(100) NOT NULL,
    prefix       VARCHAR(16) NOT NULL,
    key_hash     VARCHAR(64) NOT NULL UNIQUE,
    status       VARCHAR(16) NOT NULL DEFAULT 'active',
    last_used_at TIMESTAMP,
    created_at   TIMESTAMP NOT NULL DEFAULT NOW(),
    revoked_at   TIMESTAMP,
    CONSTRAINT chk_api_key_status CHECK (status IN ('active', 'revoked'))
);

CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS webhook_endpoints (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    url        TEXT NOT NULL,
    secret     VARCHAR(64) NOT NULL,
    events     TEXT NOT NULL DEFAULT '*',
    status     VARCHAR(16) NOT NULL DEFAULT 'active',
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_webhook_status CHECK (status IN ('active', 'disabled'))
);

CREATE INDEX IF NOT EXISTS idx_webhook_endpoints_user ON webhook_endpoints (user_id);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    endpoint_id     UUID NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
    event_type      VARCHAR(64) NOT NULL,
    payload         JSONB NOT NULL,
    status          VARCHAR(16) NOT NULL DEFAULT 'pending',
    attempts        INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMP NOT NULL DEFAULT NOW(),
    response_code   INTEGER,
    last_error      TEXT,
    created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
    delivered_at    TIMESTAMP,
    CONSTRAINT chk_delivery_status CHECK (status IN ('pending', 'delivered', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_due
    ON webhook_deliveries (next_attempt_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_endpoint
    ON webhook_deliveries (endpoint_id, created_at DESC);

COMMIT;
