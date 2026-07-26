-- Per-user assistant conversation history. Messages are stored inline as a
-- JSONB array (each conversation is small and bounded by a per-plan message
-- cap), so the whole thread is one row — no second table, no cascade, and the
-- app trims the array to the cap on every append to keep storage bounded.
CREATE TABLE IF NOT EXISTS assistant_conversations (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title      VARCHAR(120) NOT NULL DEFAULT '',
    messages   JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Lists a user's conversations most-recent-first; also backs the per-user count
-- used to enforce the max-conversations-per-plan limit.
CREATE INDEX IF NOT EXISTS idx_assistant_conversations_user
    ON assistant_conversations (user_id, updated_at DESC);
