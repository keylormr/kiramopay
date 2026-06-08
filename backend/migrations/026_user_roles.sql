-- Migration 026: user roles (RBAC for /admin/* endpoints).
-- Phase: P1 — Authorization
--
-- Until now every authenticated user could reach /admin/* routes
-- (kyc decisions, fraud alerts, reconciliation). This adds a role and the
-- RequireAdmin middleware gates those routes on role = 'admin'.

BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'user';

ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_user_role;
ALTER TABLE users ADD CONSTRAINT chk_user_role CHECK (role IN ('user','admin','support'));

-- Promote the seeded administrator (cédula 700000000) if present.
UPDATE users SET role = 'admin' WHERE cedula = '700000000';

COMMIT;
