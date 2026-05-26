-- Rollback for 020 — WARNING: this drops the immutable ledger. Only run in dev.
BEGIN;

DROP VIEW IF EXISTS wallet_journal_drift;
DROP VIEW IF EXISTS ledger_account_balances;
DROP TRIGGER IF EXISTS trg_journal_entries_immutable ON journal_entries;
DROP TRIGGER IF EXISTS trg_journal_postings_immutable ON journal_postings;
DROP TRIGGER IF EXISTS trg_journal_entries_balance ON journal_entries;
DROP TRIGGER IF EXISTS trg_users_provision_ledger ON users;
DROP FUNCTION IF EXISTS fn_journal_immutable();
DROP FUNCTION IF EXISTS fn_journal_posting_balanced();
DROP FUNCTION IF EXISTS fn_provision_user_ledger_accounts();
DROP TABLE IF EXISTS journal_entries;
DROP TABLE IF EXISTS journal_postings;
DROP TABLE IF EXISTS ledger_accounts;

-- Restore the original trigger on partitions
DO $$
DECLARE
    partition_name TEXT;
BEGIN
    FOR partition_name IN
        SELECT inhrelid::regclass::text FROM pg_inherits
        WHERE inhparent = 'transactions'::regclass
    LOOP
        EXECUTE format(
            'CREATE TRIGGER trigger_update_balance_%s
             AFTER UPDATE ON %I
             FOR EACH ROW EXECUTE FUNCTION update_wallet_balance()',
            replace(replace(partition_name, 'public.', ''), '_', '_'),
            partition_name
        );
    END LOOP;
END;
$$;

COMMIT;
