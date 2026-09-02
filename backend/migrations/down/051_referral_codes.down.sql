DROP INDEX IF EXISTS uq_loyalty_tx_referral;
ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_not_self_referred;
ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_referral_code;
DROP INDEX IF EXISTS idx_users_referred_by;
DROP INDEX IF EXISTS uq_users_referral_code;
ALTER TABLE users DROP COLUMN IF EXISTS referred_by;
ALTER TABLE users DROP COLUMN IF EXISTS referral_code;
