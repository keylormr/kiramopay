-- Migration 037: track escrow settlement so a stuck money movement is recoverable.
-- Phase: G — Security/resilience hardening
--
-- If a release/refund posting fails AND its compensating revert also fails, the
-- agreement was left in a terminal state with funds stuck in SYSTEM:ESCROW and
-- no retry. settled_at marks a completed money movement; the escrow poller
-- re-drives terminal agreements whose settled_at is NULL (the ledger posting is
-- idempotent, so re-posting either completes a stuck transfer or is a no-op).
ALTER TABLE escrow_agreements ADD COLUMN IF NOT EXISTS settled_at TIMESTAMPTZ;

-- Existing terminal agreements already settled (their posting completed before
-- this change) — mark them so the poller does not re-process them.
UPDATE escrow_agreements
   SET settled_at = COALESCE(released_at, refunded_at, NOW())
 WHERE settled_at IS NULL AND status IN ('released', 'refunded');
