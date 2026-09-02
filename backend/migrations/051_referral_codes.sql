-- Programa de referidos (minimo viable). Cada usuario tiene un codigo corto y
-- estable para invitar; el invitado queda ligado a quien lo trajo
-- (referred_by, se escribe una sola vez al registrarse). La recompensa se paga
-- en puntos de lealtad (loyalty_transactions, ref_type 'referral'), nunca en
-- dinero: no toca el ledger ni la regulacion.
--
-- El codigo NO es PII: columna plana y buscable. Alfabeto sin caracteres
-- ambiguos (sin 0/O ni 1/I/L): 31 simbolos, 8 posiciones.
ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code VARCHAR(8);
ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by UUID REFERENCES users(id) ON DELETE SET NULL;

-- El indice unico va ANTES del backfill: el bucle de abajo se apoya en
-- unique_violation para reintentar en colision.
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_referral_code ON users (referral_code);

-- Backfill de cuentas existentes. Idempotente: solo filas sin codigo.
-- gen_random_bytes viene de pgcrypto (instalado en 024).
DO $$
DECLARE
  fila      RECORD;
  alfabeto  CONSTANT TEXT := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  candidato TEXT;
BEGIN
  FOR fila IN SELECT id FROM users WHERE referral_code IS NULL LOOP
    LOOP
      candidato := '';
      FOR i IN 1..8 LOOP
        candidato := candidato ||
          substr(alfabeto, 1 + (get_byte(gen_random_bytes(1), 0) % length(alfabeto)), 1);
      END LOOP;
      BEGIN
        UPDATE users SET referral_code = candidato WHERE id = fila.id;
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        -- colision (probabilidad ~1e-12): se genera otro
      END;
    END LOOP;
  END LOOP;
END $$;

ALTER TABLE users ALTER COLUMN referral_code SET NOT NULL;
ALTER TABLE users ADD CONSTRAINT chk_users_referral_code CHECK (referral_code ~ '^[A-Z0-9]{8}$');
-- Nadie puede referirse a si mismo (tercera capa; las otras dos estan en Go).
ALTER TABLE users ADD CONSTRAINT chk_users_not_self_referred CHECK (referred_by IS NULL OR referred_by <> id);
CREATE INDEX IF NOT EXISTS idx_users_referred_by ON users (referred_by) WHERE referred_by IS NOT NULL;

-- Idempotencia del bono: un invitado paga UNA sola vez, aunque el proceso se
-- reintente. El indice parcial idx_loyalty_tx_refid (018) NO es unico.
CREATE UNIQUE INDEX IF NOT EXISTS uq_loyalty_tx_referral
  ON loyalty_transactions (ref_id) WHERE ref_type = 'referral';
