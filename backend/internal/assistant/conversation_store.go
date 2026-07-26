package assistant

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// PgConversationStore persists conversations in Postgres (one row per thread,
// messages inline as JSONB). Ownership is enforced on every query via user_id.
type PgConversationStore struct {
	db *pgxpool.Pool
}

func NewPgConversationStore(db *pgxpool.Pool) *PgConversationStore {
	return &PgConversationStore{db: db}
}

func (s *PgConversationStore) List(ctx context.Context, userID string) ([]ConversationSummary, error) {
	rows, err := s.db.Query(ctx,
		`SELECT id, title, jsonb_array_length(messages), updated_at
		 FROM assistant_conversations WHERE user_id = $1 ORDER BY updated_at DESC`, userID)
	if err != nil {
		return nil, fmt.Errorf("list conversations: %w", err)
	}
	defer rows.Close()

	out := []ConversationSummary{}
	for rows.Next() {
		var c ConversationSummary
		if err := rows.Scan(&c.ID, &c.Title, &c.MessageCount, &c.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan conversation: %w", err)
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func (s *PgConversationStore) Get(ctx context.Context, userID, id string) (*Conversation, error) {
	var c Conversation
	var raw []byte
	err := s.db.QueryRow(ctx,
		`SELECT id, title, messages, created_at, updated_at
		 FROM assistant_conversations WHERE id = $1 AND user_id = $2`, id, userID,
	).Scan(&c.ID, &c.Title, &raw, &c.CreatedAt, &c.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrConvNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("get conversation: %w", err)
	}
	if err := json.Unmarshal(raw, &c.Messages); err != nil {
		return nil, fmt.Errorf("decode messages: %w", err)
	}
	if c.Messages == nil {
		c.Messages = []StoredMessage{}
	}
	return &c, nil
}

func (s *PgConversationStore) Count(ctx context.Context, userID string) (int, error) {
	var n int
	if err := s.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM assistant_conversations WHERE user_id = $1`, userID,
	).Scan(&n); err != nil {
		return 0, fmt.Errorf("count conversations: %w", err)
	}
	return n, nil
}

func (s *PgConversationStore) Create(ctx context.Context, userID string) (*Conversation, error) {
	c := &Conversation{Messages: []StoredMessage{}}
	err := s.db.QueryRow(ctx,
		`INSERT INTO assistant_conversations (user_id) VALUES ($1)
		 RETURNING id, title, created_at, updated_at`, userID,
	).Scan(&c.ID, &c.Title, &c.CreatedAt, &c.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("create conversation: %w", err)
	}
	return c, nil
}

func (s *PgConversationStore) Delete(ctx context.Context, userID, id string) error {
	ct, err := s.db.Exec(ctx,
		`DELETE FROM assistant_conversations WHERE id = $1 AND user_id = $2`, id, userID)
	if err != nil {
		return fmt.Errorf("delete conversation: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return ErrConvNotFound
	}
	return nil
}

// Append adds messages, trims to the newest maxMessages, sets the title from the
// first user message when empty, and bumps updated_at — all in one transaction
// with a row lock so concurrent appends can't clobber each other.
func (s *PgConversationStore) Append(ctx context.Context, userID, id string, msgs []StoredMessage, maxMessages int) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var title string
	var raw []byte
	err = tx.QueryRow(ctx,
		`SELECT title, messages FROM assistant_conversations
		 WHERE id = $1 AND user_id = $2 FOR UPDATE`, id, userID,
	).Scan(&title, &raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrConvNotFound
	}
	if err != nil {
		return fmt.Errorf("load conversation: %w", err)
	}

	var existing []StoredMessage
	if err := json.Unmarshal(raw, &existing); err != nil {
		return fmt.Errorf("decode messages: %w", err)
	}
	combined := append(existing, msgs...)
	if maxMessages > 0 && len(combined) > maxMessages {
		combined = combined[len(combined)-maxMessages:]
	}

	if strings.TrimSpace(title) == "" {
		title = deriveTitle(msgs)
	}

	data, err := json.Marshal(combined)
	if err != nil {
		return fmt.Errorf("encode messages: %w", err)
	}
	if _, err := tx.Exec(ctx,
		`UPDATE assistant_conversations SET messages = $1::jsonb, title = $2, updated_at = NOW()
		 WHERE id = $3`, string(data), title, id); err != nil {
		return fmt.Errorf("update conversation: %w", err)
	}
	return tx.Commit(ctx)
}

// deriveTitle builds a short title from the first user message.
func deriveTitle(msgs []StoredMessage) string {
	for _, m := range msgs {
		if m.Role == "user" {
			t := strings.Join(strings.Fields(m.Content), " ")
			if len(t) > 60 {
				t = t[:60]
			}
			return t
		}
	}
	return ""
}
