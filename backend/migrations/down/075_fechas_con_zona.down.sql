-- Bajada de 075_fechas_con_zona.sql
--
-- Las quince columnas vuelven a timestamp sin zona, con la hora en UTC. Las
-- dos vistas se borran y se vuelven a crear igual, porque Postgres no cambia el
-- tipo de una columna que una vista lee. No se pierde ningun dato.

DROP VIEW IF EXISTS current_exchange_rates;
DROP VIEW IF EXISTS users_masked;

ALTER TABLE exchange_rates
    ALTER COLUMN effective_from TYPE TIMESTAMP USING effective_from AT TIME ZONE 'UTC',
    ALTER COLUMN effective_to TYPE TIMESTAMP USING effective_to AT TIME ZONE 'UTC';

ALTER TABLE users
    ALTER COLUMN created_at TYPE TIMESTAMP USING created_at AT TIME ZONE 'UTC',
    ALTER COLUMN updated_at TYPE TIMESTAMP USING updated_at AT TIME ZONE 'UTC',
    ALTER COLUMN last_login_at TYPE TIMESTAMP USING last_login_at AT TIME ZONE 'UTC',
    ALTER COLUMN kyc_verified_at TYPE TIMESTAMP USING kyc_verified_at AT TIME ZONE 'UTC',
    ALTER COLUMN deleted_at TYPE TIMESTAMP USING deleted_at AT TIME ZONE 'UTC';

ALTER TABLE merchant_locations
    ALTER COLUMN created_at TYPE TIMESTAMP USING created_at AT TIME ZONE 'UTC';

ALTER TABLE merchant_staff
    ALTER COLUMN created_at TYPE TIMESTAMP USING created_at AT TIME ZONE 'UTC',
    ALTER COLUMN revoked_at TYPE TIMESTAMP USING revoked_at AT TIME ZONE 'UTC';

ALTER TABLE merchant_catalog_items
    ALTER COLUMN created_at TYPE TIMESTAMP USING created_at AT TIME ZONE 'UTC';

ALTER TABLE assistant_conversations
    ALTER COLUMN created_at TYPE TIMESTAMP USING created_at AT TIME ZONE 'UTC',
    ALTER COLUMN updated_at TYPE TIMESTAMP USING updated_at AT TIME ZONE 'UTC';

ALTER TABLE user_totp
    ALTER COLUMN disabled_at TYPE TIMESTAMP USING disabled_at AT TIME ZONE 'UTC';

ALTER TABLE totp_recovery_codes
    ALTER COLUMN invalidated_at TYPE TIMESTAMP USING invalidated_at AT TIME ZONE 'UTC';

CREATE VIEW current_exchange_rates AS
    SELECT id, from_currency, to_currency, rate, spread_bps, source_rate,
           source, effective_from
    FROM exchange_rates
    WHERE effective_to IS NULL;

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
