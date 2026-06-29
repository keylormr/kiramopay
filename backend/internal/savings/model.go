package savings

import "time"

// Goal is a user's savings goal. Money saved toward it is held in SYSTEM:SAVINGS
// via the ledger; saved_minor tracks how much is allocated to this goal.
type Goal struct {
	ID          string    `json:"id"`
	UserID      string    `json:"user_id"`
	Name        string    `json:"name"`
	TargetMinor int64     `json:"target_minor"`
	SavedMinor  int64     `json:"saved_minor"`
	Currency    string    `json:"currency"`
	Icon        string    `json:"icon"`
	Color       string    `json:"color"`
	CreatedAt   time.Time `json:"created_at"`
}

type CreateGoalRequest struct {
	Name        string `json:"name"`
	TargetMinor int64  `json:"target_minor"`
	Currency    string `json:"currency"`
	Icon        string `json:"icon"`
	Color       string `json:"color"`
}

// AmountRequest is the body for deposit/withdraw.
type AmountRequest struct {
	AmountMinor int64 `json:"amount_minor"`
}
