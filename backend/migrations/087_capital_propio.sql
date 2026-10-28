-- Reservas siempre al 100 %: la cuenta de capital propio.
--
-- Decision del dueno (2026-10-28): en cada moneda, la reserva
-- (SYSTEM:RESERVE) es EXACTAMENTE igual a lo que se les debe a los usuarios,
-- despues de cualquier operacion. Lo que no es de los usuarios —lo que KiramoPay
-- cobra, lo que pone para regalar, la plata de una compra de cripto— no puede
-- vivir en la reserva: vive aqui, en el capital propio, y pasa a la reserva (o
-- sale de ella) con un asiento propio en la misma transaccion que lo provoca.
--
-- El capital propio es un activo (efectivo de la empresa), igual que la
-- reserva: se debita al entrar plata y se acredita al salir. Por eso es de
-- saldo normal 'debit'.
--
--   reserva + capital = pasivo con los usuarios
--                       + comisiones + fondo de promociones
--                       + posicion de cripto (SYSTEM:EXTERNAL) + suspenso
--
-- Las cuentas nacen en cero. Esta migracion NO escribe ningun asiento de
-- apertura: si la reserva y el pasivo que ya hay no coinciden, la diferencia
-- se ve exacta en la prueba de reservas publica y se regulariza con un asiento
-- explicito que decide el dueno, no con uno inventado aqui.

ALTER TABLE ledger_accounts DROP CONSTRAINT IF EXISTS chk_ledger_account_type;
ALTER TABLE ledger_accounts ADD CONSTRAINT chk_ledger_account_type CHECK (
    type IN ('user_wallet','system_fee','suspense','external','reserve','escrow','savings','merchant_wallet','promotions','capital')
);

INSERT INTO ledger_accounts (code, type, currency, normal_balance, metadata) VALUES
    ('SYSTEM:CAPITAL:CRC', 'capital', 'CRC', 'debit', '{"desc":"Capital propio de KiramoPay CRC"}'),
    ('SYSTEM:CAPITAL:USD', 'capital', 'USD', 'debit', '{"desc":"Capital propio de KiramoPay USD"}')
ON CONFLICT (code) DO NOTHING;
