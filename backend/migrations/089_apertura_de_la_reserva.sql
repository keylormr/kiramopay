-- Apertura de la reserva: deja la reserva igual al pasivo con los usuarios.
--
-- La migracion 087 y el cambio de asientos de este mismo PR detienen el
-- descuadre entre la reserva y lo que se les debe a los usuarios, pero no
-- borran el que ya hay. Decision del dueno (2026-10-28, "Siempre al 100 %"): el
-- capital propio de KiramoPay pone o retira lo necesario en cada moneda.
--
-- En cada moneda que tiene reserva de sistema, esta migracion calcula
-- pasivo - reserva en el momento de correr y lo asienta entre el capital
-- propio (SYSTEM:CAPITAL:<moneda>) y la reserva:
--
--   * si FALTA reserva (pasivo > reserva): el capital la pone.
--     debito reserva / credito capital. El capital queda en negativo por ese
--     monto: es la deuda de la empresa con la reserva, y se cubre con plata
--     real. Esta migracion solo la anota; el capital no tiene piso.
--   * si SOBRA reserva (reserva > pasivo): la reserva la devuelve al capital.
--     debito capital / credito reserva.
--   * con diferencia cero no asienta nada.
--
-- El pasivo se mide igual que la prueba publica de reservas: la billetera de
-- cada persona, el saldo de cada comercio, lo apartado en metas de ahorro
-- (SYSTEM:SAVINGS) y lo retenido en escrow (SYSTEM:ESCROW).
--
-- Respeta el libro inmutable: es un asiento NUEVO de partida doble en
-- journal_postings / journal_entries, nunca un UPDATE de saldos ni de asientos
-- viejos. Los dos renglones se escriben en la misma transaccion (la del
-- archivo), asi que el disparador que valida el balance los ve juntos.
--
-- Es idempotente por una referencia fija por moneda
-- ('migracion:089:apertura-de-la-reserva:<MONEDA>'): correrla otra vez no
-- repite el asiento, aunque despues haya aparecido otra diferencia. Es una
-- apertura, no un cierre periodico.
--
-- Deja rastro en audit_logs (riesgo alto, sin usuario: lo hizo una migracion) con
-- el pasivo, la reserva y la diferencia que encontro, y la referencia del
-- asiento queda en el metadato del propio asiento.

DO $apertura$
DECLARE
    cuenta      RECORD;
    capital_id  UUID;
    pasivo      BIGINT;
    en_reserva  BIGINT;
    diferencia  BIGINT;
    asiento     UUID;
    llave       TEXT;
BEGIN
    FOR cuenta IN
        SELECT id, currency FROM ledger_accounts WHERE type = 'reserve' ORDER BY currency
    LOOP
        llave := 'migracion:089:apertura-de-la-reserva:' || cuenta.currency;
        IF EXISTS (SELECT 1 FROM journal_postings WHERE idempotency_key = llave) THEN
            CONTINUE;
        END IF;

        SELECT id INTO capital_id FROM ledger_accounts WHERE code = 'SYSTEM:CAPITAL:' || cuenta.currency;
        IF capital_id IS NULL THEN
            CONTINUE;
        END IF;

        SELECT COALESCE(SUM(b.balance_minor), 0) INTO pasivo
          FROM ledger_account_balances b
         WHERE b.currency = cuenta.currency
           AND (b.type IN ('user_wallet', 'merchant_wallet')
                OR b.code LIKE 'SYSTEM:SAVINGS:%'
                OR b.code LIKE 'SYSTEM:ESCROW:%');
        SELECT COALESCE(SUM(b.balance_minor), 0) INTO en_reserva
          FROM ledger_account_balances b
         WHERE b.currency = cuenta.currency AND b.type = 'reserve';

        diferencia := pasivo - en_reserva;
        IF diferencia = 0 THEN
            CONTINUE;
        END IF;

        asiento := gen_random_uuid();
        INSERT INTO journal_postings (id, description, metadata, idempotency_key)
        VALUES (asiento,
                'Apertura de la reserva ' || cuenta.currency,
                jsonb_build_object(
                    'source', 'migration_089',
                    'currency', cuenta.currency,
                    'liabilities_minor', pasivo,
                    'reserve_minor', en_reserva,
                    'difference_minor', diferencia,
                    'direction', CASE WHEN diferencia > 0 THEN 'capital_pone_en_la_reserva'
                                      ELSE 'la_reserva_devuelve_al_capital' END),
                llave);

        IF diferencia > 0 THEN
            INSERT INTO journal_entries (posting_id, account_id, direction, amount_minor, currency) VALUES
                (asiento, cuenta.id, 'debit',  diferencia, cuenta.currency),
                (asiento, capital_id, 'credit', diferencia, cuenta.currency);
        ELSE
            INSERT INTO journal_entries (posting_id, account_id, direction, amount_minor, currency) VALUES
                (asiento, capital_id, 'debit',  -diferencia, cuenta.currency),
                (asiento, cuenta.id, 'credit', -diferencia, cuenta.currency);
        END IF;

        INSERT INTO audit_logs (user_id, action, resource_type, resource_id, details, risk_level)
        VALUES (NULL, 'apertura_de_reserva', 'ledger_account', 'SYSTEM:RESERVE:' || cuenta.currency,
                jsonb_build_object(
                    'migration', '089',
                    'currency', cuenta.currency,
                    'liabilities_minor', pasivo,
                    'reserve_minor', en_reserva,
                    'difference_minor', diferencia,
                    'posting_id', asiento,
                    'reference', llave),
                'high');
    END LOOP;
END
$apertura$;
