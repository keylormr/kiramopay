-- Migration 044: results of automated N1 identity checks (Hacienda lookup).
-- Kept separate from kyc_verifications (the manual document-review flow) so an
-- automated existence+name check is never conflated with document review.
-- Regulatory: store ONLY existence + matched name + id type. No TSE/padron
-- (electoral) data, and no plaintext id (only the HMAC token).

CREATE TABLE IF NOT EXISTS identity_verifications (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    cedula_hash   TEXT NOT NULL,          -- HMAC token, never the plaintext id
    verified_name TEXT,                   -- official name returned by the source
    id_type       TEXT,                   -- national_id | dimex | juridica | nite | unknown
    source        TEXT NOT NULL,          -- hacienda | gometa | none
    matched       BOOLEAN NOT NULL,       -- did the official name match the account name
    checked_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_identity_verifications_user
    ON identity_verifications (user_id, checked_at DESC);
