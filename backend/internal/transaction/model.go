package transaction

import "time"

type TransactionRecord struct {
	ID                string     `json:"id"`
	WalletID          string     `json:"wallet_id"`
	UserID            string     `json:"user_id"`
	Type              string     `json:"type"`
	Amount            int64      `json:"amount"`
	Currency          string     `json:"currency"`
	Fee               int64      `json:"fee"`
	CounterpartyType  string     `json:"counterparty_type,omitempty"`
	CounterpartyID    string     `json:"counterparty_id,omitempty"`
	CounterpartyName  string     `json:"counterparty_name,omitempty"`
	CounterpartyPhone string     `json:"counterparty_phone,omitempty"`
	Status            string     `json:"status"`
	ExternalReference string     `json:"external_reference,omitempty"`
	Metadata          string     `json:"metadata,omitempty"` // JSON string
	CreatedAt         time.Time  `json:"created_at"`
	ProcessedAt       *time.Time `json:"processed_at,omitempty"`
	CompletedAt       *time.Time `json:"completed_at,omitempty"`
	CreatedDate       string     `json:"created_date"`
}

// Transaction types
const (
	TypeSinpeSend    = "sinpe_send"
	TypeSinpeReceive = "sinpe_receive"
	TypeQRPayment    = "qr_payment"
	TypeQRReceive    = "qr_receive"
	TypeBillPayment  = "bill_payment"
	TypeRecharge     = "recharge"
	TypeDeposit      = "deposit"
	TypeWithdrawal   = "withdrawal"
	TypeP2PSend      = "p2p_send"
	TypeP2PReceive   = "p2p_receive"
	TypeRefund       = "refund"
)

// Transaction statuses
const (
	StatusPending    = "pending"
	StatusProcessing = "processing"
	StatusCompleted  = "completed"
	StatusFailed     = "failed"
	StatusReversed   = "reversed"
)

type CreateTransactionRequest struct {
	Type              string `json:"type"`
	Amount            int64  `json:"amount"`
	Currency          string `json:"currency"`
	Fee               int64  `json:"fee"`
	CounterpartyType  string `json:"counterparty_type,omitempty"`
	CounterpartyName  string `json:"counterparty_name,omitempty"`
	CounterpartyPhone string `json:"counterparty_phone,omitempty"`
	Description       string `json:"description,omitempty"`
	IdempotencyKey    string `json:"idempotency_key,omitempty"`
}

type ListTransactionsRequest struct {
	Limit  int    `json:"limit"`
	Offset int    `json:"offset"`
	Type   string `json:"type,omitempty"`
	Status string `json:"status,omitempty"`
}

type TransactionListResponse struct {
	Transactions []TransactionRecord `json:"transactions"`
	Total        int                 `json:"total"`
	Limit        int                 `json:"limit"`
	Offset       int                 `json:"offset"`
}
