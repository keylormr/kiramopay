package budget

import "time"

type BudgetRecord struct {
	ID          string    `json:"id"`
	UserID      string    `json:"user_id"`
	Label       string    `json:"label"`
	AmountLimit int64     `json:"amount_limit"`
	AmountSpent int64     `json:"amount_spent"`
	Currency    string    `json:"currency"`
	Icon        string    `json:"icon"`
	Color       string    `json:"color"`
	Period      string    `json:"period"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

type CreateBudgetRequest struct {
	Label       string `json:"label"`
	AmountLimit int64  `json:"amount_limit"`
	Currency    string `json:"currency"`
	Icon        string `json:"icon"`
	Color       string `json:"color"`
	Period      string `json:"period"`
}

type UpdateBudgetRequest struct {
	Label       *string `json:"label,omitempty"`
	AmountLimit *int64  `json:"amount_limit,omitempty"`
	AmountSpent *int64  `json:"amount_spent,omitempty"`
	Icon        *string `json:"icon,omitempty"`
	Color       *string `json:"color,omitempty"`
}
