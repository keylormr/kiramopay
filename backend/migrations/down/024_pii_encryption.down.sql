BEGIN;
DROP FUNCTION IF EXISTS find_user_id_by_cedula_hash(VARCHAR);
DROP FUNCTION IF EXISTS find_user_id_by_phone_hash(VARCHAR);
DROP VIEW IF EXISTS users_masked;

ALTER TABLE linked_bank_accounts DROP COLUMN IF EXISTS sinpe_phone_hash;

DROP INDEX IF EXISTS uq_users_cedula_hash;
DROP INDEX IF EXISTS uq_users_phone_hash;
DROP INDEX IF EXISTS uq_users_email_hash;

ALTER TABLE users
    DROP COLUMN IF EXISTS cedula_hash,
    DROP COLUMN IF EXISTS cedula_enc,
    DROP COLUMN IF EXISTS phone_hash,
    DROP COLUMN IF EXISTS phone_enc,
    DROP COLUMN IF EXISTS email_hash,
    DROP COLUMN IF EXISTS email_enc,
    DROP COLUMN IF EXISTS birth_date_enc;

DROP FUNCTION IF EXISTS fn_pii_encrypt(TEXT);
DROP FUNCTION IF EXISTS fn_pii_decrypt(BYTEA);
DROP FUNCTION IF EXISTS fn_pii_hmac(TEXT);
DROP FUNCTION IF EXISTS fn_encryption_key();
COMMIT;
