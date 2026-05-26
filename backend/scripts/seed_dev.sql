-- Development seed data for KiramoPay
-- Run AFTER 001_initial_schema.sql
-- WARNING: Do NOT run in production

-- Note: PIN hashes are Argon2id. These are placeholder values.
-- The actual seeding is done by the Go API on first start using real Argon2id hashes.
-- This SQL file is for reference / manual seeding with pgcrypto fallback.

-- Test User 1: Keilor Martinez (PIN: 1234)
INSERT INTO users (id, cedula, phone, first_name, last_name, pin_hash, status, kyc_level, kyc_status)
VALUES (
    'a0000000-0000-0000-0000-000000000001',
    '702650930',
    '+50688880001',
    'Keilor',
    'Martinez',
    -- Placeholder: will be replaced by API seeder with real Argon2id hash
    '$argon2id$v=19$m=65536,t=3,p=2$PLACEHOLDER$PLACEHOLDER',
    'active',
    1,
    'verified'
) ON CONFLICT (cedula) DO NOTHING;

-- Test User 2: Administrador (PIN: 0000)
INSERT INTO users (id, cedula, phone, first_name, last_name, pin_hash, status, kyc_level, kyc_status)
VALUES (
    'a0000000-0000-0000-0000-000000000002',
    '700000000',
    '+50688880002',
    'Admin',
    'KiramoPay',
    '$argon2id$v=19$m=65536,t=3,p=2$PLACEHOLDER$PLACEHOLDER',
    'active',
    2,
    'complete'
) ON CONFLICT (cedula) DO NOTHING;

-- Wallets for test users
INSERT INTO wallets (id, user_id, balance_crc, balance_usd)
VALUES (
    'w0000000-0000-0000-0000-000000000001',
    'a0000000-0000-0000-0000-000000000001',
    125750000, -- ₡1,257,500.00
    34500      -- $345.00
) ON CONFLICT (user_id) DO NOTHING;

INSERT INTO wallets (id, user_id, balance_crc, balance_usd)
VALUES (
    'w0000000-0000-0000-0000-000000000002',
    'a0000000-0000-0000-0000-000000000002',
    500000000, -- ₡5,000,000.00
    100000     -- $1,000.00
) ON CONFLICT (user_id) DO NOTHING;

-- Service providers
INSERT INTO service_providers (id, code, name, category, is_active) VALUES
    (gen_random_uuid(), 'ICE', 'ICE Electricidad', 'electricity', true),
    (gen_random_uuid(), 'CNFL', 'CNFL', 'electricity', true),
    (gen_random_uuid(), 'AYA', 'AyA', 'water', true),
    (gen_random_uuid(), 'KOLBI', 'Kölbi (ICE)', 'telecom', true),
    (gen_random_uuid(), 'CLARO', 'Claro', 'telecom', true),
    (gen_random_uuid(), 'MOVISTAR', 'Movistar', 'telecom', true),
    (gen_random_uuid(), 'LIBERTY', 'Liberty', 'internet', true)
ON CONFLICT DO NOTHING;
