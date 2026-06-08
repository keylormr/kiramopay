-- Migration 027: UIF (Unidad de Inteligencia Financiera) reporting queue.
-- Phase: P1 — Compliance (Ley 8204 CR)
--
-- Records transactions that must be reviewed/submitted to the UIF:
--   - single_threshold: one transaction >= the per-currency ceiling
--   - structuring: same-day aggregate crosses the ceiling (smurfing)
--   - manual: flagged by a compliance officer
-- A compliance officer reviews each report and marks it submitted/dismissed.

BEGIN;

CREATE TABLE IF NOT EXISTS uif_reports (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID NOT NULL REFERENCES users(id),
    tx_id             UUID,
    report_type       VARCHAR(20) NOT NULL,
    amount_minor      BIGINT NOT NULL,
    currency          VARCHAR(10) NOT NULL,
    daily_total_minor BIGINT NOT NULL DEFAULT 0,
    reason            TEXT NOT NULL,
    status            VARCHAR(20) NOT NULL DEFAULT 'pending',
    reviewer_id       UUID REFERENCES users(id),
    reviewer_notes    TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reviewed_at       TIMESTAMPTZ,
    CONSTRAINT chk_uif_type CHECK (report_type IN ('single_threshold', 'structuring', 'manual')),
    CONSTRAINT chk_uif_status CHECK (status IN ('pending', 'reviewed', 'submitted', 'dismissed')),
    CONSTRAINT chk_uif_amount CHECK (amount_minor >= 0)
);

CREATE INDEX IF NOT EXISTS idx_uif_reports_status ON uif_reports(status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_uif_reports_user ON uif_reports(user_id, created_at DESC);

-- Avoid duplicate single-transaction reports for the same tx.
CREATE UNIQUE INDEX IF NOT EXISTS uq_uif_reports_tx_single
    ON uif_reports(tx_id, report_type) WHERE tx_id IS NOT NULL;

COMMIT;
