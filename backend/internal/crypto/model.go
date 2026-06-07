package crypto

import "time"

// User's crypto holdings
type AssetRecord struct {
	ID        string    `json:"id"`
	UserID    string    `json:"user_id"`
	Symbol    string    `json:"symbol"`   // BTC, ETH, SOL, etc.
	Name      string    `json:"name"`     // Bitcoin, Ethereum, etc.
	Balance   float64   `json:"balance"`  // Crypto amount
	AvgCost   float64   `json:"avg_cost"` // Average buy price in USD
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type TransactionRecord struct {
	ID        string    `json:"id"`
	UserID    string    `json:"user_id"`
	Type      string    `json:"type"`     // buy, sell, convert, send, receive
	Asset     string    `json:"asset"`    // Symbol
	Amount    float64   `json:"amount"`   // Crypto amount
	Price     float64   `json:"price"`    // Price per unit in USD at time of tx
	Total     float64   `json:"total"`    // Total fiat amount
	Currency  string    `json:"currency"` // USD, CRC
	Fee       float64   `json:"fee"`
	Status    string    `json:"status"`
	CreatedAt time.Time `json:"created_at"`
}

type StakingRecord struct {
	ID        string    `json:"id"`
	UserID    string    `json:"user_id"`
	Asset     string    `json:"asset"`
	Amount    float64   `json:"amount"`
	APY       float64   `json:"apy"`
	StartDate time.Time `json:"start_date"`
	Locked    bool      `json:"locked"`
	LockDays  int       `json:"lock_days,omitempty"`
	Earned    float64   `json:"earned"`
	Status    string    `json:"status"` // active, completed, cancelled
	CreatedAt time.Time `json:"created_at"`
}

type PriceAlertRecord struct {
	ID          string    `json:"id"`
	UserID      string    `json:"user_id"`
	Asset       string    `json:"asset"`
	TargetPrice float64   `json:"target_price"`
	Direction   string    `json:"direction"` // above, below
	Active      bool      `json:"active"`
	CreatedAt   time.Time `json:"created_at"`
}

// API request/response types

type BuyRequest struct {
	Asset          string  `json:"asset"`
	Amount         float64 `json:"amount"`
	Price          float64 `json:"price"`
	FromCurrency   string  `json:"from_currency"`
	FromAmount     float64 `json:"from_amount"`
	IdempotencyKey string  `json:"idempotency_key,omitempty"`
}

type SellRequest struct {
	Asset          string  `json:"asset"`
	Amount         float64 `json:"amount"`
	Price          float64 `json:"price"`
	ToCurrency     string  `json:"to_currency"`
	ToAmount       float64 `json:"to_amount"`
	IdempotencyKey string  `json:"idempotency_key,omitempty"`
}

type ConvertRequest struct {
	FromAsset  string  `json:"from_asset"`
	ToAsset    string  `json:"to_asset"`
	FromAmount float64 `json:"from_amount"`
	ToAmount   float64 `json:"to_amount"`
	Price      float64 `json:"price"`
}

type StakeRequest struct {
	Asset    string  `json:"asset"`
	Amount   float64 `json:"amount"`
	APY      float64 `json:"apy"`
	Locked   bool    `json:"locked"`
	LockDays int     `json:"lock_days,omitempty"`
}

// Price data from external API
type PriceData struct {
	Symbol    string  `json:"symbol"`
	Price     float64 `json:"price"`
	Change24h float64 `json:"change_24h"`
	Volume24h float64 `json:"volume_24h"`
	MarketCap float64 `json:"market_cap"`
}
