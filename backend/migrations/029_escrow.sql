-- Migration 029: escrow agreements (buyer-funded, ledger-backed holds).
-- Phase: F — Moat / product (B2B groundwork)
--
-- Money flow is pure double-entry against a dedicated system liability
-- account (funds held on behalf of users):
--   fund:    debit buyer wallet   / credit SYSTEM:ESCROW:<CUR>
--   release: debit SYSTEM:ESCROW  / credit seller wallet
--   refund:  debit SYSTEM:ESCROW  / credit buyer wallet
-- The escrow_agreements row is workflow state; the journal is the truth.
BEGIN;

-- The 'escrow' account type was already allowed by chk_ledger_account_type
-- in migration 020; this seeds the actual accounts.
INSERT INTO ledger_accounts (code, type, currency, normal_balance, metadata) VALUES
    ('SYSTEM:ESCROW:CRC', 'escrow', 'CRC', 'credit', '{"desc":"Escrow holds CRC"}'),
    ('SYSTEM:ESCROW:USD', 'escrow', 'USD', 'credit', '{"desc":"Escrow holds USD"}')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS escrow_agreements (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    buyer_id        UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    seller_id       UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    amount_minor    BIGINT NOT NULL,
    currency        VARCHAR(3) NOT NULL DEFAULT 'CRC',
    status          VARCHAR(16) NOT NULL DEFAULT 'pending',
    description     TEXT NOT NULL,
    dispute_reason  TEXT,
    funded_at       TIMESTAMP,
    released_at     TIMESTAMP,
    refunded_at     TIMESTAMP,
    disputed_at     TIMESTAMP,
    cancelled_at    TIMESTAMP,
    created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_escrow_amount   CHECK (amount_minor > 0),
    CONSTRAINT chk_escrow_currency CHECK (currency IN ('CRC', 'USD')),
    CONSTRAINT chk_escrow_status   CHECK (status IN
        ('pending', 'funded', 'released', 'refunded', 'disputed', 'cancelled')),
    CONSTRAINT chk_escrow_parties  CHECK (buyer_id <> seller_id)
);

CREATE INDEX IF NOT EXISTS idx_escrow_buyer  ON escrow_agreements (buyer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_escrow_seller ON escrow_agreements (seller_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_escrow_status ON escrow_agreements (status) WHERE status IN ('funded', 'disputed');

COMMIT;
