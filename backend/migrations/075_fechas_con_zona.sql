-- Las fechas que quedaron sin zona horaria pasan a TIMESTAMPTZ.
--
-- La 034 convirtio todas las columnas timestamp sin zona, salvo las que leia
-- una vista: Postgres no cambia el tipo de una columna que una vista usa, y la
-- 034 las salto en silencio (users y exchange_rates). Despues la 046, la 049 y
-- la 055 volvieron a crear columnas sin zona. Un timestamp sin zona escrito con
-- NOW() guarda la hora local del servidor y la aplicacion lo lee como UTC; con
-- el servidor en UTC no se nota, en cualquier otra zona corre cada comparacion
-- de vencimiento.
--
-- Los valores guardados se interpretan como UTC, igual que en la 034:
-- produccion corre en UTC. Las dos vistas se borran y se vuelven a crear con la
-- misma definicion (la de la 021 y la de la 041); nada en la aplicacion las
-- lee y no tienen permisos propios.

DROP VIEW IF EXISTS current_exchange_rates;
DROP VIEW IF EXISTS users_masked;

ALTER TABLE exchange_rates
    ALTER COLUMN effective_from TYPE TIMESTAMPTZ USING effective_from AT TIME ZONE 'UTC',
    ALTER COLUMN effective_to TYPE TIMESTAMPTZ USING effective_to AT TIME ZONE 'UTC';

ALTER TABLE users
    ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC',
    ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC',
    ALTER COLUMN last_login_at TYPE TIMESTAMPTZ USING last_login_at AT TIME ZONE 'UTC',
    ALTER COLUMN kyc_verified_at TYPE TIMESTAMPTZ USING kyc_verified_at AT TIME ZONE 'UTC',
    ALTER COLUMN deleted_at TYPE TIMESTAMPTZ USING deleted_at AT TIME ZONE 'UTC';

ALTER TABLE merchant_locations
    ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';

ALTER TABLE merchant_staff
    ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC',
    ALTER COLUMN revoked_at TYPE TIMESTAMPTZ USING revoked_at AT TIME ZONE 'UTC';

ALTER TABLE merchant_catalog_items
    ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';

ALTER TABLE assistant_conversations
    ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC',
    ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC';

ALTER TABLE user_totp
    ALTER COLUMN disabled_at TYPE TIMESTAMPTZ USING disabled_at AT TIME ZONE 'UTC';

ALTER TABLE totp_recovery_codes
    ALTER COLUMN invalidated_at TYPE TIMESTAMPTZ USING invalidated_at AT TIME ZONE 'UTC';

-- La vista de la 021, sin cambios.
CREATE VIEW current_exchange_rates AS
    SELECT id, from_currency, to_currency, rate, spread_bps, source_rate,
           source, effective_from
    FROM exchange_rates
    WHERE effective_to IS NULL;

-- La vista de la 041, sin cambios.
CREATE VIEW users_masked AS
SELECT
    id,
    CASE WHEN fn_pii_decrypt(cedula_enc) IS NULL THEN NULL
         ELSE repeat('•', GREATEST(length(fn_pii_decrypt(cedula_enc)) - 3, 0))
              || right(fn_pii_decrypt(cedula_enc), 3)
    END AS cedula,
    cedula_type,
    CASE WHEN fn_pii_decrypt(phone_enc) IS NULL THEN NULL
         ELSE repeat('•', GREATEST(length(fn_pii_decrypt(phone_enc)) - 4, 0))
              || right(fn_pii_decrypt(phone_enc), 4)
    END AS phone,
    phone_verified,
    CASE WHEN fn_pii_decrypt(email_enc) IS NULL THEN NULL
         ELSE substring(fn_pii_decrypt(email_enc) from 1 for 1)
              || repeat('•', GREATEST(position('@' in fn_pii_decrypt(email_enc)) - 2, 0))
              || substring(fn_pii_decrypt(email_enc) from position('@' in fn_pii_decrypt(email_enc)))
    END AS email,
    email_verified,
    first_name,
    last_name,
    profile_picture_url,
    kyc_level,
    kyc_status,
    kyc_verified_at,
    status,
    created_at,
    updated_at,
    last_login_at
FROM users WHERE deleted_at IS NULL;
