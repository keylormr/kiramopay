-- Migration 045: merchant-owned ledger accounts.
--
-- Until now a QR collection credited the OWNER's personal wallet, so business
-- income and personal money were the same pot. This adds a ledger account that
-- belongs to the shop itself, so a collection lands in the business balance and
-- the owner moves it to their personal wallet explicitly.
--
-- No balance cache table on purpose: the merchant balance is derived from the
-- ledger entries, so it can never drift from the journal (the `wallets` cache
-- exists for users and is reconciled; a second cache would be a second thing to
-- keep honest).

-- Allow the 'merchant_wallet' ledger account type.
ALTER TABLE ledger_accounts DROP CONSTRAINT IF EXISTS chk_ledger_account_type;
ALTER TABLE ledger_accounts ADD CONSTRAINT chk_ledger_account_type CHECK (
    type IN ('user_wallet','system_fee','suspense','external','reserve','escrow','savings','merchant_wallet')
);

-- Owner of the account when it belongs to a shop. RESTRICT: a merchant that
-- ever held money must not be deletable out from under its journal.
ALTER TABLE ledger_accounts
    ADD COLUMN IF NOT EXISTS merchant_id UUID REFERENCES qr_merchants(id) ON DELETE RESTRICT;

-- One account per (merchant, currency); also the lookup path used to resolve
-- the account on every collection.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_accounts_merchant_ccy
    ON ledger_accounts (merchant_id, currency)
    WHERE merchant_id IS NOT NULL;
