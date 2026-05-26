package cards

import "time"

// ── Virtual Card ─────────────────────────────────────────────────────────────

type VirtualCard struct {
	ID             string     `json:"id"`
	UserID         string     `json:"user_id"`
	CardNumber     string     `json:"card_number"` // last 4 shown, full encrypted in DB
	Last4          string     `json:"last4"`
	ExpiryMonth    int        `json:"expiry_month"`
	ExpiryYear     int        `json:"expiry_year"`
	CVV            string     `json:"cvv,omitempty"` // only shown once on creation
	CardholderName string     `json:"cardholder_name"`
	Brand          string     `json:"brand"`     // visa, mastercard
	Type           string     `json:"type"`      // virtual, physical
	Currency       string     `json:"currency"`
	Status         string     `json:"status"`    // active, frozen, cancelled, expired
	DailyLimit     int64      `json:"daily_limit"`   // centimos
	MonthlyLimit   int64      `json:"monthly_limit"`  // centimos
	AtmLimit       int64      `json:"atm_limit"`      // centimos
	DailySpent     int64      `json:"daily_spent"`    // centimos
	MonthlySpent   int64      `json:"monthly_spent"`  // centimos
	ProviderCardID string     `json:"provider_card_id,omitempty"` // Stripe/Marqeta ID
	CreatedAt      time.Time  `json:"created_at"`
	FrozenAt       *time.Time `json:"frozen_at,omitempty"`
}

// ── Card Transaction ─────────────────────────────────────────────────────────

type CardTransaction struct {
	ID          string    `json:"id"`
	CardID      string    `json:"card_id"`
	UserID      string    `json:"user_id"`
	Amount      int64     `json:"amount"` // centimos
	Currency    string    `json:"currency"`
	MerchantName string   `json:"merchant_name"`
	Category    string    `json:"category"` // retail, food, transport, online, atm
	Status      string    `json:"status"`   // approved, declined, refunded
	DeclineReason string  `json:"decline_reason,omitempty"`
	CreatedAt   time.Time `json:"created_at"`
}

// Default limits (CRC centimos)
const (
	DefaultDailyLimit   = 50000000  // 500,000 CRC
	DefaultMonthlyLimit = 200000000 // 2,000,000 CRC
	DefaultATMLimit     = 10000000  // 100,000 CRC
	MaxCardsPerUser     = 5
)

// ── Request DTOs ─────────────────────────────────────────────────────────────

type CreateCardRequest struct {
	Type     string `json:"type"`     // virtual, physical
	Currency string `json:"currency"`
	Label    string `json:"label,omitempty"`
}

type UpdateLimitsRequest struct {
	DailyLimit   *int64 `json:"daily_limit,omitempty"`
	MonthlyLimit *int64 `json:"monthly_limit,omitempty"`
	AtmLimit     *int64 `json:"atm_limit,omitempty"`
}

type FreezeCardRequest struct {
	Frozen bool `json:"frozen"`
}
