-- Migration 046: business mode phase 3 — staff, locations, catalog.
--
-- A shop stops being a one-person operation: the owner can add employees
-- (cashiers that collect, managers that also run catalog/locations), split the
-- business into locations, and keep a price catalog to compose charges from.
-- Money rules do NOT change here: collections still land in the merchant
-- wallet (045) and only the OWNER can withdraw to a personal wallet.

-- Locations first: staff and QR/payment attribution reference them.
CREATE TABLE IF NOT EXISTS merchant_locations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID NOT NULL REFERENCES qr_merchants(id) ON DELETE CASCADE,
    name VARCHAR(120) NOT NULL,
    address VARCHAR(300) NOT NULL DEFAULT '',
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_merchant_locations_merchant
    ON merchant_locations (merchant_id);

-- Employees. A revoked row is kept (status = 'revoked') so re-adding the same
-- person reactivates instead of duplicating — hence the UNIQUE pair.
CREATE TABLE IF NOT EXISTS merchant_staff (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID NOT NULL REFERENCES qr_merchants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL DEFAULT 'cashier',
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    location_id UUID REFERENCES merchant_locations(id) ON DELETE SET NULL,
    added_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMP DEFAULT NOW(),
    revoked_at TIMESTAMP,
    CONSTRAINT chk_merchant_staff_role   CHECK (role IN ('cashier','manager')),
    CONSTRAINT chk_merchant_staff_status CHECK (status IN ('active','revoked')),
    CONSTRAINT uq_merchant_staff_member  UNIQUE (merchant_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_merchant_staff_user
    ON merchant_staff (user_id, status);

-- Price catalog. Prices in minor units (centimos) like every amount in the
-- ledger; a charge composed from items only carries the total + a note, so
-- deleting an item never breaks payment history.
CREATE TABLE IF NOT EXISTS merchant_catalog_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID NOT NULL REFERENCES qr_merchants(id) ON DELETE CASCADE,
    name VARCHAR(120) NOT NULL,
    price_minor BIGINT NOT NULL,
    currency VARCHAR(10) NOT NULL DEFAULT 'CRC',
    active BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    CONSTRAINT chk_catalog_price_positive CHECK (price_minor > 0)
);
CREATE INDEX IF NOT EXISTS idx_merchant_catalog_merchant
    ON merchant_catalog_items (merchant_id, active);

-- Attribution: which location a QR charges for, and (on the payment) who
-- generated the charge. SET NULL keeps history rows alive if a location or
-- user ever goes away.
ALTER TABLE qr_payment_codes
    ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES merchant_locations(id) ON DELETE SET NULL;
ALTER TABLE qr_payments
    ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES merchant_locations(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS collected_by UUID REFERENCES users(id) ON DELETE SET NULL;

-- The per-shop sales feed reads by merchant, newest first.
CREATE INDEX IF NOT EXISTS idx_qr_payments_merchant_created
    ON qr_payments (merchant_id, created_at DESC)
    WHERE merchant_id IS NOT NULL;
