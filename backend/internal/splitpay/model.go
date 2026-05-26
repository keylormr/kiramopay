package splitpay

import "time"

// ── Split Group ──────────────────────────────────────────────────────────────

type SplitGroup struct {
	ID          string    `json:"id"`
	CreatorID   string    `json:"creator_id"`
	Title       string    `json:"title"`
	Description string    `json:"description,omitempty"`
	TotalAmount int64     `json:"total_amount"` // centimos
	Currency    string    `json:"currency"`
	SplitType   string    `json:"split_type"` // equal, custom, percentage
	Status      string    `json:"status"`     // active, settled, cancelled
	CreatedAt   time.Time `json:"created_at"`
	SettledAt   *time.Time `json:"settled_at,omitempty"`
}

// ── Split Share ──────────────────────────────────────────────────────────────

type SplitShare struct {
	ID        string     `json:"id"`
	GroupID   string     `json:"group_id"`
	UserID    string     `json:"user_id"`
	UserPhone string     `json:"user_phone,omitempty"` // for non-registered users
	UserName  string     `json:"user_name"`
	Amount    int64      `json:"amount"` // centimos
	Status    string     `json:"status"` // pending, paid, declined
	PaidAt    *time.Time `json:"paid_at,omitempty"`
}

// ── Request DTOs ─────────────────────────────────────────────────────────────

type CreateSplitRequest struct {
	Title       string             `json:"title"`
	Description string             `json:"description,omitempty"`
	TotalAmount int64              `json:"total_amount"` // centimos
	Currency    string             `json:"currency"`
	SplitType   string             `json:"split_type"` // equal, custom, percentage
	Participants []ParticipantReq  `json:"participants"`
}

type ParticipantReq struct {
	UserID    string `json:"user_id,omitempty"`
	UserPhone string `json:"user_phone,omitempty"`
	UserName  string `json:"user_name"`
	Amount    int64  `json:"amount,omitempty"`      // for custom split
	Percentage float64 `json:"percentage,omitempty"` // for percentage split
}

type PayShareRequest struct {
	GroupID string `json:"group_id"`
}
