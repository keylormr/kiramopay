-- Migration 042: backfill wallet limits for unverified (KYC level 0) users.
-- Migration 001 defaults wallets.daily_limit/monthly_limit to the "Verified"
-- tier (500k / 5M CRC). New wallets are now pinned to the Basic tier at
-- creation (wallet.CreateForUser), but accounts created before that fix kept
-- the over-permissive default, letting unverified users transact well above
-- their intended cap. Lower ONLY the wallets that (a) belong to a level-0
-- user and (b) still carry the untouched 001 default, so any deliberate
-- per-account adjustment (a different value) is left alone.
UPDATE wallets w SET
    daily_limit   = 10000000,  -- Basic: 100,000 CRC
    monthly_limit = 50000000,  -- Basic: 500,000 CRC
    updated_at    = NOW()
FROM users u
WHERE w.user_id = u.id
  AND u.kyc_level = 0
  AND w.daily_limit = 50000000     -- untouched 001 default (Verified tier)
  AND w.monthly_limit = 500000000;
