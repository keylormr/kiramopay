package recurring

import "time"

type RecurringPaymentRecord struct {
	ID                string     `json:"id"`
	UserID            string     `json:"user_id"`
	Label             string     `json:"label"`
	Type              string     `json:"type"`
	Amount            int64      `json:"amount"`
	Currency          string     `json:"currency"`
	Frequency         string     `json:"frequency"`
	NextDate          string     `json:"next_date"`
	LastPaidDate      *string    `json:"last_paid_date,omitempty"`
	RecipientPhone    string     `json:"recipient_phone,omitempty"`
	RecipientName     string     `json:"recipient_name,omitempty"`
	ServiceProviderID string     `json:"service_provider_id,omitempty"`
	ClientID          string     `json:"client_id,omitempty"`
	Enabled           bool       `json:"enabled"`
	CreatedAt         time.Time  `json:"created_at"`
	UpdatedAt         time.Time  `json:"updated_at"`
}

type CreateRecurringRequest struct {
	Label             string `json:"label"`
	Type              string `json:"type"`
	Amount            int64  `json:"amount"`
	Currency          string `json:"currency"`
	Frequency         string `json:"frequency"`
	NextDate          string `json:"next_date"`
	RecipientPhone    string `json:"recipient_phone,omitempty"`
	RecipientName     string `json:"recipient_name,omitempty"`
	ServiceProviderID string `json:"service_provider_id,omitempty"`
	ClientID          string `json:"client_id,omitempty"`
}

type UpdateRecurringRequest struct {
	Label     *string `json:"label,omitempty"`
	Amount    *int64  `json:"amount,omitempty"`
	Frequency *string `json:"frequency,omitempty"`
	NextDate  *string `json:"next_date,omitempty"`
}
