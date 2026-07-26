-- Billing plan per user (free/plus/pro). Drives per-plan limits such as the
-- assistant's daily quota. Defaults to 'free'; paid upgrades are wired later
-- (no charging path yet), so today every user is 'free' unless set manually.
ALTER TABLE users ADD COLUMN IF NOT EXISTS plan VARCHAR(10) NOT NULL DEFAULT 'free';
ALTER TABLE users ADD CONSTRAINT chk_users_plan CHECK (plan IN ('free', 'plus', 'pro'));
