-- Migration 024: Column-level PII encryption with searchable HMAC for lookups.
-- Phase: P1 — Data protection
--
-- Approach:
--   - pgcrypto pgp_sym_encrypt for *_encrypted columns (envelope key in KMS,
--     here we use a settings-provided key for portability).
--   - Deterministic HMAC (sha256) for cedula/phone/email so we can still
--     index and look up by hash without exposing the plaintext.
--   - Plaintext columns kept for backward compatibility during cutover; a
--     follow-up migration drops them once application code stops reading.
--   - users_masked view shows redacted values for support/analytics roles.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =========================================================================
-- 1. Key management — read encryption key from custom GUC at runtime.
--    Set via: ALTER DATABASE kiramopay SET kiramopay.encryption_key TO '...';
-- =========================================================================
CREATE OR REPLACE FUNCTION fn_encryption_key() RETURNS TEXT AS $$
DECLARE
    k TEXT;
BEGIN
    BEGIN
        k := current_setting('kiramopay.encryption_key');
    EXCEPTION WHEN OTHERS THEN
        k := NULL;
    END;
    IF k IS NULL OR length(k) < 32 THEN
        RAISE EXCEPTION 'kiramopay.encryption_key not set or too short (>=32 chars required)';
    END IF;
    RETURN k;
END;
$$ LANGUAGE plpgsql STABLE;

-- HMAC for search-tokens (uses the same key but with a fixed salt).
CREATE OR REPLACE FUNCTION fn_pii_hmac(p_value TEXT) RETURNS VARCHAR(64) AS $$
    SELECT encode(hmac(lower(trim(p_value)), fn_encryption_key() || ':pii', 'sha256'), 'hex');
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION fn_pii_encrypt(p_value TEXT) RETURNS BYTEA AS $$
    SELECT CASE WHEN p_value IS NULL OR p_value = '' THEN NULL
                ELSE pgp_sym_encrypt(p_value, fn_encryption_key(),
                                     'compress-algo=2, cipher-algo=aes256')
           END;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION fn_pii_decrypt(p_blob BYTEA) RETURNS TEXT AS $$
    SELECT CASE WHEN p_blob IS NULL THEN NULL
                ELSE pgp_sym_decrypt(p_blob, fn_encryption_key())
           END;
$$ LANGUAGE sql STABLE;

-- =========================================================================
-- 2. Add encrypted columns to users.
-- =========================================================================
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS cedula_hash    VARCHAR(64),
    ADD COLUMN IF NOT EXISTS cedula_enc     BYTEA,
    ADD COLUMN IF NOT EXISTS phone_hash     VARCHAR(64),
    ADD COLUMN IF NOT EXISTS phone_enc      BYTEA,
    ADD COLUMN IF NOT EXISTS email_hash     VARCHAR(64),
    ADD COLUMN IF NOT EXISTS email_enc      BYTEA,
    ADD COLUMN IF NOT EXISTS birth_date_enc BYTEA;

-- Indexes on hashes for lookup parity
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_cedula_hash
    ON users (cedula_hash) WHERE cedula_hash IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_phone_hash
    ON users (phone_hash) WHERE phone_hash IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email_hash
    ON users (email_hash) WHERE email_hash IS NOT NULL;

-- =========================================================================
-- 3. Backfill: encrypt/hash existing plaintext.
--    Only runs if the key is set; otherwise migration is no-op (so devs
--    without the key can still apply the schema part).
-- =========================================================================
DO $$
DECLARE
    has_key BOOLEAN;
BEGIN
    BEGIN
        PERFORM fn_encryption_key();
        has_key := TRUE;
    EXCEPTION WHEN OTHERS THEN
        has_key := FALSE;
    END;

    IF has_key THEN
        UPDATE users SET
            cedula_hash    = COALESCE(cedula_hash,    fn_pii_hmac(cedula)),
            cedula_enc     = COALESCE(cedula_enc,     fn_pii_encrypt(cedula)),
            phone_hash     = COALESCE(phone_hash,     fn_pii_hmac(phone)),
            phone_enc      = COALESCE(phone_enc,      fn_pii_encrypt(phone)),
            email_hash     = CASE WHEN email IS NULL THEN NULL ELSE COALESCE(email_hash, fn_pii_hmac(email)) END,
            email_enc      = CASE WHEN email IS NULL THEN NULL ELSE COALESCE(email_enc,  fn_pii_encrypt(email)) END,
            birth_date_enc = CASE WHEN birth_date IS NULL THEN NULL
                                  ELSE COALESCE(birth_date_enc, fn_pii_encrypt(birth_date::text)) END
        WHERE cedula_hash IS NULL OR phone_hash IS NULL;
    ELSE
        RAISE NOTICE 'kiramopay.encryption_key not set — encrypted columns added but not backfilled. Run backfill later.';
    END IF;
END $$;

-- =========================================================================
-- 4. linked_bank_accounts encrypted columns are already BYTEA; add a search
--    HMAC for SINPE phone alongside the encrypted value.
-- =========================================================================
ALTER TABLE linked_bank_accounts
    ADD COLUMN IF NOT EXISTS sinpe_phone_hash VARCHAR(64);

CREATE INDEX IF NOT EXISTS idx_lba_sinpe_phone_hash
    ON linked_bank_accounts (sinpe_phone_hash)
    WHERE sinpe_phone_hash IS NOT NULL;

-- =========================================================================
-- 5. Masked view for support / BI roles.
-- =========================================================================
CREATE OR REPLACE VIEW users_masked AS
SELECT
    id,
    -- Cedula: show last 3 digits.
    CASE WHEN cedula IS NULL THEN NULL
         ELSE repeat('•', GREATEST(length(cedula) - 3, 0))
              || right(cedula, 3)
    END AS cedula,
    cedula_type,
    -- Phone: show last 4.
    CASE WHEN phone IS NULL THEN NULL
         ELSE repeat('•', GREATEST(length(phone) - 4, 0))
              || right(phone, 4)
    END AS phone,
    phone_verified,
    -- Email: a***@domain
    CASE WHEN email IS NULL THEN NULL
         ELSE substring(email from 1 for 1)
              || repeat('•', GREATEST(position('@' in email) - 2, 0))
              || substring(email from position('@' in email))
    END AS email,
    email_verified,
    first_name,
    last_name,
    profile_picture_url,
    kyc_level,
    kyc_status,
    kyc_verified_at,
    status,
    created_at,
    updated_at,
    last_login_at
FROM users
WHERE deleted_at IS NULL;

-- =========================================================================
-- 6. Lookup helper functions (used by Go repos via parameter):
-- =========================================================================
CREATE OR REPLACE FUNCTION find_user_id_by_cedula_hash(p_hash VARCHAR(64))
RETURNS UUID AS $$
    SELECT id FROM users WHERE cedula_hash = p_hash AND deleted_at IS NULL LIMIT 1;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION find_user_id_by_phone_hash(p_hash VARCHAR(64))
RETURNS UUID AS $$
    SELECT id FROM users WHERE phone_hash = p_hash AND deleted_at IS NULL LIMIT 1;
$$ LANGUAGE sql STABLE;

COMMIT;
