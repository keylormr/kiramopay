-- Migration 032: outbound payouts over pluggable rails (ledger-backed).
-- Phase: F — Moat / product (interoperability groundwork)
--
-- Money flow is pure double-entry against a per-rail external liability
-- account, so payout balances are provable from the journal:
--   submit: debit user wallet            / credit SYSTEM:EXTERNAL:<RAIL>:<CUR>
--   refund: debit SYSTEM:EXTERNAL:<RAIL> / credit user wallet   (rail rejected)
-- The payouts row is workflow state; the journal is the truth.
--
-- Adding a real rail = register its adapter in code AND seed its
-- SYSTEM:EXTERNAL:<RAIL>:<CUR> accounts in a follow-up migration (mirror the
-- MOCK seed below). The 'external' account type already exists (migration 020).
BEGIN;

INSERT INTO ledger_accounts (code, type, currency, normal_balance, metadata) VALUES
    ('SYSTEM:EXTERNAL:MOCK:CRC', 'external', 'CRC', 'credit', '{"desc":"Mock payout rail CRC"}'),
    ('SYSTEM:EXTERNAL:MOCK:USD', 'external', 'USD', 'credit', '{"desc":"Mock payout rail USD"}')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS payouts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    rail            VARCHAR(32) NOT NULL,
    amount_minor    BIGINT NOT NULL,
    currency        VARCHAR(3) NOT NULL DEFAULT 'CRC',
    status          VARCHAR(16) NOT NULL DEFAULT 'pending',
    destination     JSONB NOT NULL,
    external_id     TEXT,
    failure_reason  TEXT,
    idempotency_key TEXT NOT NULL,
    processing_at   TIMESTAMP,
    completed_at    TIMESTAMP,
    failed_at       TIMESTAMP,
    created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_payout_amount   CHECK (amount_minor > 0),
    CONSTRAINT chk_payout_currency CHECK (currency IN ('CRC', 'USD')),
    CONSTRAINT chk_payout_status   CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    CONSTRAINT uq_payout_idempotency UNIQUE (user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_payout_user ON payouts (user_id, created_at DESC);
-- Partial index powering the settlement poller's "stuck in processing" scan.
CREATE INDEX IF NOT EXISTS idx_payout_processing
    ON payouts (processing_at) WHERE status = 'processing';

COMMIT;
