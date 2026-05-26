package country

import "time"

// ── Country Configuration ────────────────────────────────────────────────────

type Country struct {
	ID             string    `json:"id"`
	Code           string    `json:"code"`        // CR, PA, GT
	Name           string    `json:"name"`
	Currency       string    `json:"currency"`     // CRC, PAB, GTQ
	CurrencySymbol string    `json:"currency_symbol"` // ₡, B/., Q
	CurrencyName   string    `json:"currency_name"`
	PhonePrefix    string    `json:"phone_prefix"` // +506, +507, +502
	FlagEmoji      string    `json:"flag_emoji"`
	Active         bool      `json:"active"`
	Timezone       string    `json:"timezone"`
	Locale         string    `json:"locale"`       // es-CR, es-PA, es-GT
	CreatedAt      time.Time `json:"created_at"`
}

// ── Exchange Rate ────────────────────────────────────────────────────────────

type ExchangeRate struct {
	ID           string    `json:"id"`
	FromCurrency string    `json:"from_currency"`
	ToCurrency   string    `json:"to_currency"`
	Rate         float64   `json:"rate"`
	Source       string    `json:"source"` // bccr, manual, api
	UpdatedAt    time.Time `json:"updated_at"`
}

// ── Regional Wallet ──────────────────────────────────────────────────────────

type RegionalWallet struct {
	ID          string    `json:"id"`
	UserID      string    `json:"user_id"`
	CountryCode string    `json:"country_code"`
	Currency    string    `json:"currency"`
	Balance     int64     `json:"balance"` // in smallest unit (centimos/centavos)
	Active      bool      `json:"active"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// ── Cross-Border Transfer ────────────────────────────────────────────────────

type CrossBorderTransfer struct {
	ID               string     `json:"id"`
	SenderID         string     `json:"sender_id"`
	ReceiverID       string     `json:"receiver_id,omitempty"`
	ReceiverPhone    string     `json:"receiver_phone"`
	FromCountry      string     `json:"from_country"`
	ToCountry        string     `json:"to_country"`
	FromCurrency     string     `json:"from_currency"`
	ToCurrency       string     `json:"to_currency"`
	FromAmount       int64      `json:"from_amount"` // sent amount in source currency smallest unit
	ToAmount         int64      `json:"to_amount"`   // received amount in target currency smallest unit
	ExchangeRate     float64    `json:"exchange_rate"`
	Fee              int64      `json:"fee"` // in source currency smallest unit
	Status           string     `json:"status"` // pending, processing, completed, failed, cancelled
	ComplianceStatus string     `json:"compliance_status"` // pending, approved, rejected
	CreatedAt        time.Time  `json:"created_at"`
	CompletedAt      *time.Time `json:"completed_at,omitempty"`
}

// Regional transfer limits (per day, in USD equivalent centavos)
const (
	DailyTransferLimitUSD = 500000  // $5,000 USD in centavos
	PerTransferLimitUSD   = 100000  // $1,000 USD in centavos
	TransferFeePercent    = 1.5     // 1.5% fee on cross-border
	MinTransferFee        = 150     // $1.50 USD minimum fee
)

// ── Request DTOs ─────────────────────────────────────────────────────────────

type CrossBorderRequest struct {
	ReceiverPhone string `json:"receiver_phone"`
	ToCountry     string `json:"to_country"`
	Amount        int64  `json:"amount"` // in source currency smallest unit
	Currency      string `json:"currency"`
}

type ConvertCurrencyRequest struct {
	FromCurrency string `json:"from_currency"`
	ToCurrency   string `json:"to_currency"`
	Amount       int64  `json:"amount"` // in source currency smallest unit
}
