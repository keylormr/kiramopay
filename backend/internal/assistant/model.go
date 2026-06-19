// Package assistant implements a conversational financial assistant. The LLM
// runs behind the backend (never the client) so the API key is never exposed
// and every capability is server-controlled.
//
// Phase 3a (this package) is READ-ONLY: the model can answer questions about
// the signed-in user's own data through a fixed set of read-only tools
// (balance, transactions, budgets). It has NO ability to move money — there are
// no write tools, so prompt-injection cannot make it spend. A later phase 3b
// can add write tools that return a *proposal* the user confirms
// deterministically (passing the existing MFA/limits/fraud gates); the model
// would still never authorize a movement itself.
package assistant

import "errors"

// Role identifies who produced a turn in the conversation.
type Role string

const (
	RoleUser  Role = "user"
	RoleModel Role = "model"
	RoleTool  Role = "tool" // a function/tool result fed back to the model
)

// Turn is one conversation message exchanged over the API (text only).
type Turn struct {
	Role string `json:"role"` // "user" | "assistant"
	Text string `json:"text"`
}

// ChatRequest is the payload for POST /assistant/chat.
type ChatRequest struct {
	Message string `json:"message"`
	History []Turn `json:"history,omitempty"` // prior turns for context (bounded)
}

// ChatResponse is the assistant's answer.
type ChatResponse struct {
	Reply     string     `json:"reply"`
	ToolsUsed []string   `json:"tools_used,omitempty"`
	Proposals []Proposal `json:"proposals,omitempty"`
}

// Proposal is a money-moving action the assistant has PREPARED but NOT executed
// (Phase 3b). The propose_* tools only validate and echo — they never touch a
// money service. The client renders a confirmation card; only on explicit user
// confirmation does it call the real, fully-gated endpoint (which re-enforces
// auth/MFA/limits/fraud). The assistant never authorizes a movement.
type Proposal struct {
	Kind        string `json:"kind"` // sinpe_transfer | bill_payment | recharge
	Summary     string `json:"summary"`
	AmountMinor int64  `json:"amount_minor"`
	Currency    string `json:"currency"`
	// sinpe_transfer
	Phone       string `json:"phone,omitempty"`
	Description string `json:"description,omitempty"`
	// bill_payment
	ProviderCode string `json:"provider_code,omitempty"`
	ProviderName string `json:"provider_name,omitempty"`
	ClientID     string `json:"client_id,omitempty"`
	Period       string `json:"period,omitempty"`
	// recharge
	Operator string `json:"operator,omitempty"`
}

// Domain errors mapped to HTTP statuses by the handler.
var (
	// ErrUnavailable means the assistant is not configured (no GEMINI_API_KEY).
	ErrUnavailable = errors.New("assistant: not configured")
	// ErrInvalidRequest is a malformed/empty request.
	ErrInvalidRequest = errors.New("assistant: invalid request")
	// ErrLLM wraps an upstream model failure.
	ErrLLM = errors.New("assistant: model request failed")
)
