-- Migration 041: PII-at-rest cutover.
-- The application now writes/reads cedula, phone and email ONLY through the
-- encrypted columns (cedula_enc/phone_enc/email_enc) and the searchable HMAC
-- tokens (cedula_hash/phone_hash) added in migration 024. This migration
-- backfills any rows that still lack the encrypted values, makes the encrypted
-- columns authoritative, and DROPS the plaintext cedula/phone/email columns so
-- the data is no longer stored in cleartext.
--
-- FAIL-CLOSED: the backfill calls fn_pii_* which RAISE when the
-- kiramopay.encryption_key GUC is unset, so the whole migration (wrapped in a
-- transaction by the runner) aborts BEFORE dropping any column — no silent data
-- loss. Set the key (PII_ENCRYPTION_KEY env on the app, which sets the GUC per
-- connection) before deploying this migration.

-- 1. Backfill encrypted/hashed values for any rows missing them.
UPDATE users SET
    cedula_hash = COALESCE(cedula_hash, fn_pii_hmac(cedula)),
    cedula_enc  = COALESCE(cedula_enc,  fn_pii_encrypt(cedula)),
    phone_hash  = COALESCE(phone_hash,  fn_pii_hmac(phone)),
    phone_enc   = COALESCE(phone_enc,   fn_pii_encrypt(phone)),
    email_hash  = CASE WHEN email IS NULL OR email = '' THEN email_hash
                       ELSE COALESCE(email_hash, fn_pii_hmac(email)) END,
    email_enc   = CASE WHEN email IS NULL OR email = '' THEN email_enc
                       ELSE COALESCE(email_enc,  fn_pii_encrypt(email)) END
WHERE cedula_hash IS NULL OR cedula_enc IS NULL
   OR phone_hash IS NULL OR phone_enc IS NULL;

-- 2. The encrypted columns are now authoritative for cedula/phone.
ALTER TABLE users ALTER COLUMN cedula_enc SET NOT NULL;
ALTER TABLE users ALTER COLUMN cedula_hash SET NOT NULL;
ALTER TABLE users ALTER COLUMN phone_enc SET NOT NULL;
ALTER TABLE users ALTER COLUMN phone_hash SET NOT NULL;

-- 3. The masked view references the plaintext columns; drop it before they go.
DROP VIEW IF EXISTS users_masked;

-- 4. Drop the plaintext PII columns — PII is no longer stored in cleartext.
ALTER TABLE users
    DROP COLUMN IF EXISTS cedula,
    DROP COLUMN IF EXISTS phone,
    DROP COLUMN IF EXISTS email;

-- 5. Recreate the masked view from the encrypted columns (decrypt + redact).
CREATE VIEW users_masked AS
SELECT
    id,
    CASE WHEN fn_pii_decrypt(cedula_enc) IS NULL THEN NULL
         ELSE repeat('•', GREATEST(length(fn_pii_decrypt(cedula_enc)) - 3, 0))
              || right(fn_pii_decrypt(cedula_enc), 3)
    END AS cedula,
    cedula_type,
    CASE WHEN fn_pii_decrypt(phone_enc) IS NULL THEN NULL
         ELSE repeat('•', GREATEST(length(fn_pii_decrypt(phone_enc)) - 4, 0))
              || right(fn_pii_decrypt(phone_enc), 4)
    END AS phone,
    phone_verified,
    CASE WHEN fn_pii_decrypt(email_enc) IS NULL THEN NULL
         ELSE substring(fn_pii_decrypt(email_enc) from 1 for 1)
              || repeat('•', GREATEST(position('@' in fn_pii_decrypt(email_enc)) - 2, 0))
              || substring(fn_pii_decrypt(email_enc) from position('@' in fn_pii_decrypt(email_enc)))
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
FROM users WHERE deleted_at IS NULL;
