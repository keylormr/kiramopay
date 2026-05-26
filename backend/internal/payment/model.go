package payment

import "time"

type PayBillRequest struct {
	ProviderCode string `json:"provider_code"`
	ClientID     string `json:"client_id"`
	Amount       int64  `json:"amount"` // centimos
	Period       string `json:"period,omitempty"`
}

type PayBillResponse struct {
	TransactionID string `json:"transaction_id"`
	ReceiptNumber string `json:"receipt_number"`
	ProviderName  string `json:"provider_name"`
	Amount        int64  `json:"amount"`
	Status        string `json:"status"`
}

type RechargeRequest struct {
	Operator string `json:"operator"` // 'kolbi', 'claro', 'movistar'
	Phone    string `json:"phone"`
	Amount   int64  `json:"amount"` // centimos
}

type RechargeResponse struct {
	TransactionID string `json:"transaction_id"`
	Operator      string `json:"operator"`
	Phone         string `json:"phone"`
	Amount        int64  `json:"amount"`
	Status        string `json:"status"`
}

type SavedServiceRecord struct {
	ID             string    `json:"id"`
	UserID         string    `json:"user_id"`
	ProviderCode   string    `json:"provider_code"`
	ProviderName   string    `json:"provider_name"`
	ClientID       string    `json:"client_id"`
	Nickname       string    `json:"nickname,omitempty"`
	AutoPayEnabled bool      `json:"auto_pay_enabled"`
	CreatedAt      time.Time `json:"created_at"`
}

type PaymentHistoryRecord struct {
	ID           string    `json:"id"`
	UserID       string    `json:"user_id"`
	Type         string    `json:"type"` // 'bill' or 'recharge'
	ProviderCode string    `json:"provider_code"`
	ProviderName string    `json:"provider_name"`
	ClientID     string    `json:"client_id"`
	Amount       int64     `json:"amount"`
	Status       string    `json:"status"`
	CreatedAt    time.Time `json:"created_at"`
}
