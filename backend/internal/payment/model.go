package payment

import "time"

type PayBillRequest struct {
	ProviderCode string `json:"provider_code"`
	ClientID     string `json:"client_id"`
	Amount       int64  `json:"amount"` // centimos
	Period       string `json:"period,omitempty"`
	// IdempotencyKey: la misma llave con los mismos datos contesta con el pago
	// que ya estaba hecho en vez de cobrar otro. La pone la pantalla y la
	// conserva mientras no sabe que paso (la red se corto, el servidor fallo).
	IdempotencyKey string `json:"idempotency_key,omitempty"`
}

type PayBillResponse struct {
	TransactionID string `json:"transaction_id"`
	ReceiptNumber string `json:"receipt_number"`
	ProviderName  string `json:"provider_name"`
	Amount        int64  `json:"amount"`
	Status        string `json:"status"`
	// Replayed dice que la respuesta repite un pago que ya estaba hecho bajo
	// esa llave: esta llamada no cobro nada. La pantalla lo dice asi, en vez de
	// celebrar un pago nuevo y anotarlo otra vez.
	Replayed bool `json:"replayed,omitempty"`
}

type RechargeRequest struct {
	Operator string `json:"operator"` // 'kolbi', 'claro', 'movistar'
	Phone    string `json:"phone"`
	Amount   int64  `json:"amount"` // centimos
	// IdempotencyKey: como en PayBillRequest.
	IdempotencyKey string `json:"idempotency_key,omitempty"`
}

type RechargeResponse struct {
	TransactionID string `json:"transaction_id"`
	Operator      string `json:"operator"`
	Phone         string `json:"phone"`
	Amount        int64  `json:"amount"`
	Status        string `json:"status"`
	// Replayed: como en PayBillResponse.
	Replayed bool `json:"replayed,omitempty"`
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
