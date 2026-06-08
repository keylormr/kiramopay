package sinpe

import "time"

type ContactRecord struct {
	ID        string    `json:"id"`
	UserID    string    `json:"user_id"`
	Phone     string    `json:"phone"`
	Name      string    `json:"name"`
	Bank      string    `json:"bank,omitempty"`
	IsFav     bool      `json:"is_favorite"`
	CreatedAt time.Time `json:"created_at"`
}

type SendRequest struct {
	Phone          string `json:"phone"`
	Amount         int64  `json:"amount"` // In centimos (CRC)
	Description    string `json:"description,omitempty"`
	IdempotencyKey string `json:"idempotency_key,omitempty"`
}

type SendResponse struct {
	TransactionID string `json:"transaction_id"`
	Status        string `json:"status"`
	Amount        int64  `json:"amount"`
	Fee           int64  `json:"fee"`
	Recipient     string `json:"recipient"`
}

// SINPE Móvil limits (per BCCR public reference; kept independently here).
const (
	DailyLimitCRC       int64 = 50000000 // 500,000 CRC in centimos
	MaxSinglePaymentCRC int64 = 50000000 // 500,000 CRC per single tx
	TransactionFee      int64 = 15000    // 150 CRC fee for cross-bank
	MFAThresholdCRC     int64 = 10000000 // 100,000 CRC — MFA gated above this
)

type HistoryRecord struct {
	ID          string    `json:"id"`
	UserID      string    `json:"user_id"`
	Phone       string    `json:"phone"`
	ContactName string    `json:"contact_name"`
	Amount      int64     `json:"amount"`
	Fee         int64     `json:"fee"`
	Type        string    `json:"type"` // "sent" or "received"
	Status      string    `json:"status"`
	Description string    `json:"description"`
	CreatedAt   time.Time `json:"created_at"`
}
