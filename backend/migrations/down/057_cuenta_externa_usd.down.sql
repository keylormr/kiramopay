-- Solo se borra si nunca se uso: una cuenta con asientos no se puede quitar
-- sin romper el libro, y borrar el asiento no es una opcion.
DELETE FROM ledger_accounts
 WHERE code = 'SYSTEM:EXTERNAL:USD'
   AND NOT EXISTS (
       SELECT 1 FROM journal_entries je
        WHERE je.account_id = ledger_accounts.id
   );
