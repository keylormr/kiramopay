-- Migration 038: multi-merchant per user + merchant light-KYC + per-merchant commission.
-- Phase: H — China/Pix merchant model
--
-- The QR-merchant rail launched single-merchant-per-user (UNIQUE user_id) and 1:1
-- payments with no fee. This migration turns qr_merchants into a real merchant
-- profile:
--   1. Drops the UNIQUE(user_id) so one person can run several businesses (each
--      its own row + qr_code).
--   2. Adds light-KYC fields (cedula, cedula_type, legal_name) and an admin
--      verification workflow (verification_status pending|verified|rejected,
--      reviewed_at, reviewed_by, rejection_reason). The rail is left ready to plug
--      an automated KYC provider later; for now an admin approves/rejects.
--   3. Adds a per-merchant commission in basis points (commission_bps, default 50
--      = 0.50%). The fee is absorbed by the MERCHANT: the payer pays the displayed
--      amount, the merchant is credited amount - fee, and the fee is booked to the
--      existing SYSTEM:FEES ledger account inside ScanAndPay. Integer bps keeps the
--      money math exact (no floats in the ledger path).
--   4. Records the commission charged on each qr_payments row for history/audit.

-- 1. Multi-merchant: drop the column-level UNIQUE on user_id (name-agnostic so it
--    works regardless of how Postgres auto-named the constraint) and replace it
--    with a plain index for the per-user lookup.
DO $$
DECLARE c text;
BEGIN
    SELECT conname INTO c
      FROM pg_constraint
     WHERE conrelid = 'qr_merchants'::regclass
       AND contype = 'u'
       AND conkey = ARRAY[(
             SELECT attnum FROM pg_attribute
              WHERE attrelid = 'qr_merchants'::regclass AND attname = 'user_id')];
    IF c IS NOT NULL THEN
        EXECUTE format('ALTER TABLE qr_merchants DROP CONSTRAINT %I', c);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_qr_merchants_user ON qr_merchants(user_id);

-- 2. Light KYC + admin verification workflow.
ALTER TABLE qr_merchants ADD COLUMN IF NOT EXISTS cedula VARCHAR(50) NOT NULL DEFAULT '';
ALTER TABLE qr_merchants ADD COLUMN IF NOT EXISTS cedula_type VARCHAR(20) NOT NULL DEFAULT 'fisica';
ALTER TABLE qr_merchants ADD COLUMN IF NOT EXISTS legal_name VARCHAR(200) NOT NULL DEFAULT '';
ALTER TABLE qr_merchants ADD COLUMN IF NOT EXISTS verification_status VARCHAR(20) NOT NULL DEFAULT 'pending';
ALTER TABLE qr_merchants ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
ALTER TABLE qr_merchants ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES users(id);
ALTER TABLE qr_merchants ADD COLUMN IF NOT EXISTS rejection_reason TEXT NOT NULL DEFAULT '';

-- Grandfather legacy merchants: any row that exists at migration time predates
-- the verification requirement, so mark it verified instead of leaving it
-- 'pending' (which would block its existing QR payments under the new gate).
-- New merchants registered after this migration get 'pending' via the default.
UPDATE qr_merchants SET verification_status = 'verified' WHERE verification_status = 'pending';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conrelid = 'qr_merchants'::regclass AND conname = 'chk_qr_merchant_status') THEN
        ALTER TABLE qr_merchants
            ADD CONSTRAINT chk_qr_merchant_status
            CHECK (verification_status IN ('pending', 'verified', 'rejected'));
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conrelid = 'qr_merchants'::regclass AND conname = 'chk_qr_merchant_cedula_type') THEN
        ALTER TABLE qr_merchants
            ADD CONSTRAINT chk_qr_merchant_cedula_type
            CHECK (cedula_type IN ('fisica', 'juridica'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_qr_merchants_status ON qr_merchants(verification_status);

-- 3. Per-merchant commission, basis points (integer; exact money math). 50 = 0.50%.
ALTER TABLE qr_merchants ADD COLUMN IF NOT EXISTS commission_bps INTEGER NOT NULL DEFAULT 50;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conrelid = 'qr_merchants'::regclass AND conname = 'chk_qr_merchant_commission_bps') THEN
        ALTER TABLE qr_merchants
            ADD CONSTRAINT chk_qr_merchant_commission_bps
            CHECK (commission_bps >= 0 AND commission_bps <= 10000);
    END IF;
END $$;

-- 4. Record the commission charged on each merchant payment (0 for P2P codes).
ALTER TABLE qr_payments ADD COLUMN IF NOT EXISTS fee BIGINT NOT NULL DEFAULT 0;
