-- Migration 020: Append-only double-entry journal ledger
-- Phase: P0 — Core banking foundation
--
-- Pattern: Every monetary movement is one transaction emitting >= 2 journal
-- entries (one DEBIT, one CREDIT) that must sum to zero per currency per
-- atomic posting. wallets.balance_* becomes a derived cache; the journal is
-- the source of truth.
--
-- Inspired by Stripe Ledger / Increase / Modern Treasury patterns.

BEGIN;

-- =========================================================================
-- 1. Chart of accounts — internal "system" accounts (fees, suspense, FX).
-- =========================================================================
CREATE TABLE IF NOT EXISTS ledger_accounts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code            VARCHAR(64) NOT NULL UNIQUE,
    type            VARCHAR(32) NOT NULL,  -- 'user_wallet','system_fee','suspense','external','reserve'
    user_id         UUID REFERENCES users(id) ON DELETE RESTRICT,
    currency        VARCHAR(3) NOT NULL,
    normal_balance  VARCHAR(8) NOT NULL,   -- 'debit' (assets) or 'credit' (liabilities)
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMP DEFAULT NOW(),
    CONSTRAINT chk_ledger_account_type CHECK (
        type IN ('user_wallet','system_fee','suspense','external','reserve','escrow')
    ),
    CONSTRAINT chk_ledger_account_normal CHECK (normal_balance IN ('debit','credit')),
    CONSTRAINT chk_ledger_account_user_kind CHECK (
        (type = 'user_wallet' AND user_id IS NOT NULL)
        OR (type <> 'user_wallet' AND user_id IS NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ledger_user_currency
    ON ledger_accounts (user_id, currency)
    WHERE type = 'user_wallet';

-- Seed the system accounts (idempotent)
INSERT INTO ledger_accounts (code, type, currency, normal_balance, metadata) VALUES
    ('SYSTEM:FEES:CRC',      'system_fee', 'CRC', 'credit', '{"desc":"Fees revenue CRC"}'),
    ('SYSTEM:FEES:USD',      'system_fee', 'USD', 'credit', '{"desc":"Fees revenue USD"}'),
    ('SYSTEM:SUSPENSE:CRC',  'suspense',   'CRC', 'credit', '{"desc":"In-flight CRC"}'),
    ('SYSTEM:SUSPENSE:USD',  'suspense',   'USD', 'credit', '{"desc":"In-flight USD"}'),
    ('SYSTEM:EXTERNAL:CRC',  'external',   'CRC', 'credit', '{"desc":"SINPE external counterparty"}'),
    ('SYSTEM:RESERVE:CRC',   'reserve',    'CRC', 'debit',  '{"desc":"Reserve fund CRC"}'),
    ('SYSTEM:RESERVE:USD',   'reserve',    'USD', 'debit',  '{"desc":"Reserve fund USD"}')
ON CONFLICT (code) DO NOTHING;

-- =========================================================================
-- 2. journal_postings — one row per atomic monetary event.
-- =========================================================================
CREATE TABLE IF NOT EXISTS journal_postings (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tx_id           UUID,                          -- optional link to transactions.id
    posted_at       TIMESTAMP NOT NULL DEFAULT NOW(),
    description     TEXT NOT NULL,
    metadata        JSONB DEFAULT '{}',
    -- Idempotency for postings themselves (user-scoped where applicable):
    idempotency_key VARCHAR(80),
    created_by      UUID REFERENCES users(id),
    UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_journal_postings_tx ON journal_postings (tx_id)
    WHERE tx_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_journal_postings_time ON journal_postings (posted_at);

-- =========================================================================
-- 3. journal_entries — append-only debit/credit lines.
--    Every entry belongs to a posting; sum of debits = sum of credits
--    per currency per posting (enforced via trigger).
-- =========================================================================
CREATE TABLE IF NOT EXISTS journal_entries (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    posting_id   UUID NOT NULL REFERENCES journal_postings(id) ON DELETE RESTRICT,
    account_id   UUID NOT NULL REFERENCES ledger_accounts(id) ON DELETE RESTRICT,
    direction    VARCHAR(8) NOT NULL,           -- 'debit' | 'credit'
    amount_minor BIGINT NOT NULL,               -- always positive; sign comes from direction
    currency     VARCHAR(3) NOT NULL,
    created_at   TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_je_direction CHECK (direction IN ('debit','credit')),
    CONSTRAINT chk_je_amount_positive CHECK (amount_minor > 0)
);

CREATE INDEX IF NOT EXISTS idx_je_posting   ON journal_entries (posting_id);
CREATE INDEX IF NOT EXISTS idx_je_account   ON journal_entries (account_id, created_at);
CREATE INDEX IF NOT EXISTS idx_je_currency  ON journal_entries (currency, created_at);

-- =========================================================================
-- 4. Validation trigger: each posting must balance per currency.
--    We run this as a CONSTRAINT TRIGGER DEFERRED so multiple entries
--    can be inserted in a single tx before validation fires at COMMIT.
-- =========================================================================
CREATE OR REPLACE FUNCTION fn_journal_posting_balanced()
RETURNS TRIGGER AS $$
DECLARE
    unbalanced RECORD;
BEGIN
    FOR unbalanced IN
        SELECT je.currency,
               SUM(CASE WHEN je.direction = 'debit'  THEN je.amount_minor ELSE 0 END) AS dr,
               SUM(CASE WHEN je.direction = 'credit' THEN je.amount_minor ELSE 0 END) AS cr
        FROM journal_entries je
        WHERE je.posting_id = NEW.posting_id
        GROUP BY je.currency
        HAVING SUM(CASE WHEN je.direction = 'debit'  THEN je.amount_minor ELSE 0 END)
             <> SUM(CASE WHEN je.direction = 'credit' THEN je.amount_minor ELSE 0 END)
    LOOP
        RAISE EXCEPTION
            'journal posting % unbalanced for currency %: debit=%, credit=%',
            NEW.posting_id, unbalanced.currency, unbalanced.dr, unbalanced.cr
            USING ERRCODE = 'check_violation';
    END LOOP;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_journal_entries_balance ON journal_entries;
CREATE CONSTRAINT TRIGGER trg_journal_entries_balance
    AFTER INSERT ON journal_entries
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    EXECUTE FUNCTION fn_journal_posting_balanced();

-- =========================================================================
-- 5. Block UPDATE and DELETE on journal — append-only by trigger.
--    We don't rely on a role REVOKE alone because pgx connects as the app
--    role; this defends against application bugs too.
-- =========================================================================
CREATE OR REPLACE FUNCTION fn_journal_immutable()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'journal entries are append-only (op=%, tbl=%)',
        TG_OP, TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_journal_entries_immutable ON journal_entries;
CREATE TRIGGER trg_journal_entries_immutable
    BEFORE UPDATE OR DELETE ON journal_entries
    FOR EACH ROW EXECUTE FUNCTION fn_journal_immutable();

DROP TRIGGER IF EXISTS trg_journal_postings_immutable ON journal_postings;
CREATE TRIGGER trg_journal_postings_immutable
    BEFORE UPDATE OR DELETE ON journal_postings
    FOR EACH ROW EXECUTE FUNCTION fn_journal_immutable();

-- =========================================================================
-- 6. Balance derivation view + helper function (single source of truth).
-- =========================================================================
CREATE OR REPLACE VIEW ledger_account_balances AS
SELECT
    la.id AS account_id,
    la.code,
    la.type,
    la.user_id,
    la.currency,
    la.normal_balance,
    COALESCE(SUM(CASE WHEN je.direction = 'debit'  THEN je.amount_minor ELSE 0 END), 0) AS total_debit,
    COALESCE(SUM(CASE WHEN je.direction = 'credit' THEN je.amount_minor ELSE 0 END), 0) AS total_credit,
    -- Signed balance: debit-normal accounts are debit-positive, credit-normal accounts credit-positive.
    CASE la.normal_balance
        WHEN 'debit'  THEN COALESCE(SUM(CASE WHEN je.direction = 'debit'  THEN je.amount_minor ELSE -je.amount_minor END), 0)
        WHEN 'credit' THEN COALESCE(SUM(CASE WHEN je.direction = 'credit' THEN je.amount_minor ELSE -je.amount_minor END), 0)
    END AS balance_minor
FROM ledger_accounts la
LEFT JOIN journal_entries je ON je.account_id = la.id
GROUP BY la.id, la.code, la.type, la.user_id, la.currency, la.normal_balance;

-- =========================================================================
-- 7. Provision: create a ledger_account for every existing user/currency.
-- =========================================================================
INSERT INTO ledger_accounts (code, type, user_id, currency, normal_balance, metadata)
SELECT
    'USER:' || u.id || ':CRC',
    'user_wallet',
    u.id,
    'CRC',
    'credit',  -- user wallet is a liability of the institution to the user
    '{}'::jsonb
FROM users u
ON CONFLICT (code) DO NOTHING;

INSERT INTO ledger_accounts (code, type, user_id, currency, normal_balance, metadata)
SELECT
    'USER:' || u.id || ':USD',
    'user_wallet',
    u.id,
    'USD',
    'credit',
    '{}'::jsonb
FROM users u
ON CONFLICT (code) DO NOTHING;

-- =========================================================================
-- 8. Trigger on user creation: auto-provision ledger accounts per currency.
-- =========================================================================
CREATE OR REPLACE FUNCTION fn_provision_user_ledger_accounts()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO ledger_accounts (code, type, user_id, currency, normal_balance)
    VALUES
        ('USER:' || NEW.id || ':CRC', 'user_wallet', NEW.id, 'CRC', 'credit'),
        ('USER:' || NEW.id || ':USD', 'user_wallet', NEW.id, 'USD', 'credit')
    ON CONFLICT (code) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_provision_ledger ON users;
CREATE TRIGGER trg_users_provision_ledger
    AFTER INSERT ON users
    FOR EACH ROW EXECUTE FUNCTION fn_provision_user_ledger_accounts();

-- =========================================================================
-- 9. Backfill: seed the journal with existing wallet balances as opening entries
--    paired against the SYSTEM:RESERVE account so the books balance.
-- =========================================================================
DO $$
DECLARE
    posting_id UUID;
    reserve_crc UUID;
    reserve_usd UUID;
BEGIN
    SELECT id INTO reserve_crc FROM ledger_accounts WHERE code = 'SYSTEM:RESERVE:CRC';
    SELECT id INTO reserve_usd FROM ledger_accounts WHERE code = 'SYSTEM:RESERVE:USD';

    -- One posting per (user, currency) with non-zero balance
    FOR posting_id IN
        SELECT gen_random_uuid()
        FROM wallets w
        WHERE w.balance_crc > 0
    LOOP
        NULL;  -- placeholder; real backfill done below
    END LOOP;

    -- Backfill CRC
    INSERT INTO journal_postings (id, posted_at, description, metadata)
    SELECT gen_random_uuid(), NOW(), 'OPENING_BALANCE_BACKFILL_CRC',
           jsonb_build_object('user_id', w.user_id, 'source', 'migration_020')
    FROM wallets w
    WHERE w.balance_crc > 0;

    -- For each user with non-zero CRC, write 2 entries: credit user, debit reserve.
    INSERT INTO journal_entries (posting_id, account_id, direction, amount_minor, currency)
    SELECT
        p.id, ua.id, 'credit', w.balance_crc, 'CRC'
    FROM wallets w
    JOIN ledger_accounts ua ON ua.user_id = w.user_id AND ua.currency = 'CRC'
    JOIN journal_postings p ON (p.metadata->>'user_id')::uuid = w.user_id
                            AND p.description = 'OPENING_BALANCE_BACKFILL_CRC'
    WHERE w.balance_crc > 0;

    INSERT INTO journal_entries (posting_id, account_id, direction, amount_minor, currency)
    SELECT
        p.id, reserve_crc, 'debit', w.balance_crc, 'CRC'
    FROM wallets w
    JOIN journal_postings p ON (p.metadata->>'user_id')::uuid = w.user_id
                            AND p.description = 'OPENING_BALANCE_BACKFILL_CRC'
    WHERE w.balance_crc > 0;

    -- USD
    INSERT INTO journal_postings (id, posted_at, description, metadata)
    SELECT gen_random_uuid(), NOW(), 'OPENING_BALANCE_BACKFILL_USD',
           jsonb_build_object('user_id', w.user_id, 'source', 'migration_020')
    FROM wallets w
    WHERE w.balance_usd > 0;

    INSERT INTO journal_entries (posting_id, account_id, direction, amount_minor, currency)
    SELECT p.id, ua.id, 'credit', w.balance_usd, 'USD'
    FROM wallets w
    JOIN ledger_accounts ua ON ua.user_id = w.user_id AND ua.currency = 'USD'
    JOIN journal_postings p ON (p.metadata->>'user_id')::uuid = w.user_id
                            AND p.description = 'OPENING_BALANCE_BACKFILL_USD'
    WHERE w.balance_usd > 0;

    INSERT INTO journal_entries (posting_id, account_id, direction, amount_minor, currency)
    SELECT p.id, reserve_usd, 'debit', w.balance_usd, 'USD'
    FROM wallets w
    JOIN journal_postings p ON (p.metadata->>'user_id')::uuid = w.user_id
                            AND p.description = 'OPENING_BALANCE_BACKFILL_USD'
    WHERE w.balance_usd > 0;
END;
$$;

-- =========================================================================
-- 10. Disable the legacy update_wallet_balance trigger.
--     Balance updates now come from the journal posting code, not transaction
--     status flips. We KEEP wallets.balance_* as a cached materialized number
--     and update it in the same SQL tx that writes the journal.
-- =========================================================================
DO $$
DECLARE
    partition_name TEXT;
BEGIN
    FOR partition_name IN
        SELECT inhrelid::regclass::text
        FROM pg_inherits
        WHERE inhparent = 'transactions'::regclass
    LOOP
        EXECUTE format(
            'DROP TRIGGER IF EXISTS trigger_update_balance_%s ON %I',
            replace(replace(partition_name, 'public.', ''), '_', '_'),
            partition_name
        );
    END LOOP;
END;
$$;

-- =========================================================================
-- 11. Reconciliation helper view: detect drift between wallets cache and journal.
-- =========================================================================
CREATE OR REPLACE VIEW wallet_journal_drift AS
SELECT
    w.user_id,
    w.balance_crc AS cache_crc,
    COALESCE(crc.balance_minor, 0) AS journal_crc,
    (w.balance_crc - COALESCE(crc.balance_minor, 0)) AS drift_crc,
    w.balance_usd AS cache_usd,
    COALESCE(usd.balance_minor, 0) AS journal_usd,
    (w.balance_usd - COALESCE(usd.balance_minor, 0)) AS drift_usd
FROM wallets w
LEFT JOIN ledger_account_balances crc
       ON crc.user_id = w.user_id AND crc.currency = 'CRC'
LEFT JOIN ledger_account_balances usd
       ON usd.user_id = w.user_id AND usd.currency = 'USD';

COMMIT;
