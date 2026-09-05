-- La contraparte externa en dolares.
--
-- La migracion 020 sembro SYSTEM:EXTERNAL:CRC y nada mas, asi que el asiento
-- de una operacion en dolares contra el exterior (una compra de cripto con
-- FromCurrency=USD, un deposito o un retiro en USD) se anotaba en una cuenta
-- DECLARADA en colones. El libro cuadra igual —los asientos balancean por
-- moneda—, pero la cuenta externa queda con dos monedas mezcladas y cualquier
-- conciliacion por moneda sale mal. El resto de cuentas del sistema (FEES,
-- SUSPENSE, RESERVE) ya tenian su par CRC/USD; a esta le faltaba.
--
-- Es la misma forma que 032 uso para los rieles de payout, que si sembro
-- SYSTEM:EXTERNAL:MOCK:CRC y SYSTEM:EXTERNAL:MOCK:USD desde el primer dia.
INSERT INTO ledger_accounts (code, type, currency, normal_balance, metadata) VALUES
    ('SYSTEM:EXTERNAL:USD', 'external', 'USD', 'credit', '{"desc":"External counterparty USD"}')
ON CONFLICT (code) DO NOTHING;
