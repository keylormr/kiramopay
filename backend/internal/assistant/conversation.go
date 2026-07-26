package assistant

import (
	"context"
	"errors"
	"time"
)

// Conversation-history errors surfaced to the handler.
var (
	// ErrConvNotFound means the conversation doesn't exist or isn't the caller's.
	ErrConvNotFound = errors.New("assistant: conversation not found")
	// ErrConvLimit means the user already has the maximum conversations for
	// their plan; they must delete one before starting another.
	ErrConvLimit = errors.New("assistant: conversation limit reached")
)

// StoredMessage is one persisted turn in a conversation. Role is "user" or
// "assistant"; proposals and tool calls are not persisted (only the text).
type StoredMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// Conversation is a full saved thread with its messages.
type Conversation struct {
	ID        string          `json:"id"`
	Title     string          `json:"title"`
	Messages  []StoredMessage `json:"messages"`
	CreatedAt time.Time       `json:"created_at"`
	UpdatedAt time.Time       `json:"updated_at"`
}

// ConversationSummary is the lightweight list entry (no message bodies).
type ConversationSummary struct {
	ID           string    `json:"id"`
	Title        string    `json:"title"`
	MessageCount int       `json:"message_count"`
	UpdatedAt    time.Time `json:"updated_at"`
}

// ConversationStore persists per-user conversation history.
type ConversationStore interface {
	List(ctx context.Context, userID string) ([]ConversationSummary, error)
	Get(ctx context.Context, userID, id string) (*Conversation, error)
	Count(ctx context.Context, userID string) (int, error)
	Create(ctx context.Context, userID string) (*Conversation, error)
	Delete(ctx context.Context, userID, id string) error
	// Append adds messages to a conversation, trims the thread to keep at most
	// maxMessages (dropping the oldest), sets the title from the first user
	// message when empty, and bumps updated_at.
	Append(ctx context.Context, userID, id string, msgs []StoredMessage, maxMessages int) error
}

// ConversationService applies the per-plan conversation and message limits on
// top of the store. A nil service (Service.conv) means history is disabled.
type ConversationService struct {
	store      ConversationStore
	planOf     PlanResolver
	convLimits map[string]int // plan -> max conversations
	msgLimits  map[string]int // plan -> max messages per conversation
}

// NewConversationService wires the store and per-plan limits. Missing/invalid
// "free" entries fall back to sane defaults (2 conversations, 30 messages).
func NewConversationService(store ConversationStore, planOf PlanResolver, convLimits, msgLimits map[string]int) *ConversationService {
	cl := copyLimits(convLimits, 2)
	ml := copyLimits(msgLimits, 30)
	return &ConversationService{store: store, planOf: planOf, convLimits: cl, msgLimits: ml}
}

func copyLimits(in map[string]int, freeFallback int) map[string]int {
	out := map[string]int{}
	for k, v := range in {
		out[k] = v
	}
	if out["free"] <= 0 {
		out["free"] = freeFallback
	}
	return out
}

func (c *ConversationService) plan(ctx context.Context, userID string) string {
	if c.planOf != nil {
		if p, err := c.planOf(ctx, userID); err == nil && p != "" {
			return p
		}
	}
	return "free"
}

func limitFrom(limits map[string]int, plan string) int {
	if v := limits[plan]; v > 0 {
		return v
	}
	return limits["free"]
}

func (c *ConversationService) List(ctx context.Context, userID string) ([]ConversationSummary, error) {
	return c.store.List(ctx, userID)
}

func (c *ConversationService) Get(ctx context.Context, userID, id string) (*Conversation, error) {
	return c.store.Get(ctx, userID, id)
}

func (c *ConversationService) Delete(ctx context.Context, userID, id string) error {
	return c.store.Delete(ctx, userID, id)
}

// Create makes a new empty conversation, rejecting with ErrConvLimit when the
// user is already at their plan's maximum.
func (c *ConversationService) Create(ctx context.Context, userID string) (*Conversation, error) {
	count, err := c.store.Count(ctx, userID)
	if err != nil {
		return nil, err
	}
	if count >= limitFrom(c.convLimits, c.plan(ctx, userID)) {
		return nil, ErrConvLimit
	}
	return c.store.Create(ctx, userID)
}

// persist appends the user message and assistant reply to a conversation,
// trimmed to the plan's per-conversation message cap.
func (c *ConversationService) persist(ctx context.Context, userID, id, userMsg, reply string) error {
	cap := limitFrom(c.msgLimits, c.plan(ctx, userID))
	return c.store.Append(ctx, userID, id, []StoredMessage{
		{Role: "user", Content: userMsg},
		{Role: "assistant", Content: reply},
	}, cap)
}
