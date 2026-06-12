-- Down migration for 029_escrow.sql
BEGIN;
DROP TABLE IF EXISTS escrow_agreements;
DELETE FROM ledger_accounts
 WHERE code IN ('SYSTEM:ESCROW:CRC', 'SYSTEM:ESCROW:USD')
   AND NOT EXISTS (SELECT 1 FROM journal_entries je
                   WHERE je.account_id = ledger_accounts.id);
COMMIT;
