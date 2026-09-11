-- Revierte la 066: los premios vuelven a quedar inactivos (como los dejo la
-- 060) y se quita la columna del monto. La cuenta de promociones NO se borra si
-- tiene movimientos: el libro es de solo agregar.
UPDATE loyalty_rewards SET active = FALSE WHERE cashback_minor IS NOT NULL;
ALTER TABLE loyalty_rewards DROP CONSTRAINT IF EXISTS chk_loyalty_cashback_positivo;
ALTER TABLE loyalty_rewards DROP COLUMN IF EXISTS cashback_minor;
DELETE FROM ledger_accounts a
 WHERE a.code = 'SYSTEM:PROMOTIONS:CRC'
   AND NOT EXISTS (SELECT 1 FROM journal_entries je WHERE je.account_id = a.id);
