-- Migration 025: KYC / AML foundation.
-- Phase: P1 — Compliance
--
-- Adds:
--   - kyc_verifications: the submission + review lifecycle per user.
--   - kyc_documents: references + integrity hashes (NEVER raw image bytes).
--   - sanction_list: local watchlist (OFAC/UN/local) to screen names against.
--     In production this is fed by a provider (ComplyAdvantage / Sanctions.io);
--     the schema + screening logic stay the same.
--   - sanction_screenings: an audit trail of every screen performed.
--
-- KYC levels (already on users.kyc_level): 0 basic, 1 verified, 2 complete.
-- Wallet limits scale with level (enforced by application code).

BEGIN;

CREATE TABLE IF NOT EXISTS kyc_verifications (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID NOT NULL REFERENCES users(id),
    level_requested  INTEGER NOT NULL,
    status           VARCHAR(20) NOT NULL DEFAULT 'pending',
    full_legal_name  VARCHAR(200) NOT NULL,
    birth_date       DATE,
    nationality      VARCHAR(2),            -- ISO-3166 alpha-2
    document_type    VARCHAR(30) NOT NULL,  -- national_id, passport, dimex
    document_number  VARCHAR(60) NOT NULL,
    screening_result VARCHAR(20) NOT NULL DEFAULT 'pending', -- clean, hit, error, pending
    reviewer_notes   TEXT,
    decided_by       UUID REFERENCES users(id),
    submitted_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    decided_at       TIMESTAMPTZ,
    CONSTRAINT chk_kyc_level CHECK (level_requested BETWEEN 1 AND 2),
    CONSTRAINT chk_kyc_status CHECK (status IN ('pending','approved','rejected','screening_hit')),
    CONSTRAINT chk_kyc_screening CHECK (screening_result IN ('pending','clean','hit','error'))
);
CREATE INDEX IF NOT EXISTS idx_kyc_verifications_user ON kyc_verifications(user_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_kyc_verifications_status ON kyc_verifications(status) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS kyc_documents (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    verification_id UUID NOT NULL REFERENCES kyc_verifications(id) ON DELETE CASCADE,
    doc_type        VARCHAR(30) NOT NULL, -- id_front, id_back, proof_of_address, selfie
    file_ref        TEXT NOT NULL,        -- object-store key / URL — NOT the bytes
    sha256          VARCHAR(64),          -- integrity hash of the uploaded file
    uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_kyc_doc_type CHECK (doc_type IN ('id_front','id_back','proof_of_address','selfie'))
);
CREATE INDEX IF NOT EXISTS idx_kyc_documents_verification ON kyc_documents(verification_id);

CREATE TABLE IF NOT EXISTS sanction_list (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source          VARCHAR(20) NOT NULL,  -- OFAC, UN, EU, local
    full_name       VARCHAR(200) NOT NULL,
    normalized_name VARCHAR(200) NOT NULL,  -- lowercased, trimmed, single-spaced
    birth_date      DATE,
    nationality     VARCHAR(2),
    program         VARCHAR(100),
    added_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sanction_list_norm ON sanction_list(normalized_name);

CREATE TABLE IF NOT EXISTS sanction_screenings (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID REFERENCES users(id),
    verification_id  UUID REFERENCES kyc_verifications(id) ON DELETE SET NULL,
    query_name       VARCHAR(200) NOT NULL,
    normalized_query VARCHAR(200) NOT NULL,
    result           VARCHAR(20) NOT NULL,  -- clean, hit, error
    match_count      INTEGER NOT NULL DEFAULT 0,
    matched_ids      TEXT,                  -- comma-separated sanction_list ids
    screened_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_screening_result CHECK (result IN ('clean','hit','error'))
);
CREATE INDEX IF NOT EXISTS idx_sanction_screenings_user ON sanction_screenings(user_id, screened_at DESC);

-- Seed a few FICTIONAL watchlist entries so screening is exercisable.
-- Replace with a real provider feed in production.
INSERT INTO sanction_list (source, full_name, normalized_name, nationality, program) VALUES
    ('OFAC',  'Carlos Sancion Prueba',      'carlos sancion prueba',      'CR', 'SDN-TEST'),
    ('UN',    'Ivan Testovich Blocklisted', 'ivan testovich blocklisted', 'RU', 'UNSC-TEST'),
    ('local', 'Empresa Fantasma Lavado SA', 'empresa fantasma lavado sa', 'CR', 'LOCAL-AML')
ON CONFLICT DO NOTHING;

COMMIT;
