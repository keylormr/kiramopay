-- Down migration for 032_payouts.sql
BEGIN;
DROP TABLE IF EXISTS payouts;
DELETE FROM ledger_accounts
 WHERE code IN ('SYSTEM:EXTERNAL:MOCK:CRC', 'SYSTEM:EXTERNAL:MOCK:USD')
   AND NOT EXISTS (SELECT 1 FROM journal_entries je
                   WHERE je.account_id = ledger_accounts.id);
COMMIT;
