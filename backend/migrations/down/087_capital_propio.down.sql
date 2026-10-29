-- Revierte la 087: se quitan las cuentas de capital propio que no tienen
-- movimientos (el libro es de solo agregar: una con asientos se queda) y, si no
-- queda ninguna, el tipo 'capital' sale de la lista permitida.
DELETE FROM ledger_accounts a
 WHERE a.code IN ('SYSTEM:CAPITAL:CRC', 'SYSTEM:CAPITAL:USD')
   AND NOT EXISTS (SELECT 1 FROM journal_entries je WHERE je.account_id = a.id);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM ledger_accounts WHERE type = 'capital') THEN
        ALTER TABLE ledger_accounts DROP CONSTRAINT IF EXISTS chk_ledger_account_type;
        ALTER TABLE ledger_accounts ADD CONSTRAINT chk_ledger_account_type CHECK (
            type IN ('user_wallet','system_fee','suspense','external','reserve','escrow','savings','merchant_wallet','promotions')
        );
    END IF;
END
$$;
