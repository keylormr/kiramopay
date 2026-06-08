package crypto

import (
	"time"

	"github.com/shopspring/decimal"
)

// Crypto asset quantities and per-unit prices are NUMERIC(38,18) in the DB and
// decimal.Decimal in Go — never float64. decimal.UnmarshalJSON parses the JSON
// numeric literal exactly (no float round-trip), so the JSON contract with the
// frontend is unchanged: it still sends and receives plain numbers.

// User's crypto holdings
type AssetRecord struct {
	ID        string          `json:"id"`
	UserID    string          `json:"user_id"`
	Symbol    string          `json:"symbol"`   // BTC, ETH, SOL, etc.
	Name      string          `json:"name"`     // Bitcoin, Ethereum, etc.
	Balance   decimal.Decimal `json:"balance"`  // Crypto amount
	AvgCost   decimal.Decimal `json:"avg_cost"` // Average buy price in USD
	CreatedAt time.Time       `json:"created_at"`
	UpdatedAt time.Time       `json:"updated_at"`
}

type TransactionRecord struct {
	ID        string          `json:"id"`
	UserID    string          `json:"user_id"`
	Type      string          `json:"type"`     // buy, sell, convert, send, receive
	Asset     string          `json:"asset"`    // Symbol
	Amount    decimal.Decimal `json:"amount"`   // Crypto amount
	Price     decimal.Decimal `json:"price"`    // Price per unit in USD at time of tx
	Total     decimal.Decimal `json:"total"`    // Total fiat amount
	Currency  string          `json:"currency"` // USD, CRC
	Fee       decimal.Decimal `json:"fee"`
	Status    string          `json:"status"`
	CreatedAt time.Time       `json:"created_at"`
}

type StakingRecord struct {
	ID        string          `json:"id"`
	UserID    string          `json:"user_id"`
	Asset     string          `json:"asset"`
	Amount    decimal.Decimal `json:"amount"`
	APY       float64         `json:"apy"` // rate, NUMERIC(8,4); precision non-critical
	StartDate time.Time       `json:"start_date"`
	Locked    bool            `json:"locked"`
	LockDays  int             `json:"lock_days,omitempty"`
	Earned    decimal.Decimal `json:"earned"`
	Status    string          `json:"status"` // active, completed, cancelled
	CreatedAt time.Time       `json:"created_at"`
}

type PriceAlertRecord struct {
	ID          string          `json:"id"`
	UserID      string          `json:"user_id"`
	Asset       string          `json:"asset"`
	TargetPrice decimal.Decimal `json:"target_price"`
	Direction   string          `json:"direction"` // above, below
	Active      bool            `json:"active"`
	CreatedAt   time.Time       `json:"created_at"`
}

// API request/response types

type BuyRequest struct {
	Asset          string          `json:"asset"`
	Amount         decimal.Decimal `json:"amount"` // crypto quantity bought
	Price          decimal.Decimal `json:"price"`
	FromCurrency   string          `json:"from_currency"`
	FromAmount     decimal.Decimal `json:"from_amount"` // fiat paid
	IdempotencyKey string          `json:"idempotency_key,omitempty"`
}

type SellRequest struct {
	Asset          string          `json:"asset"`
	Amount         decimal.Decimal `json:"amount"` // crypto quantity sold
	Price          decimal.Decimal `json:"price"`
	ToCurrency     string          `json:"to_currency"`
	ToAmount       decimal.Decimal `json:"to_amount"` // fiat received
	IdempotencyKey string          `json:"idempotency_key,omitempty"`
}

type ConvertRequest struct {
	FromAsset  string          `json:"from_asset"`
	ToAsset    string          `json:"to_asset"`
	FromAmount decimal.Decimal `json:"from_amount"`
	ToAmount   decimal.Decimal `json:"to_amount"`
	Price      decimal.Decimal `json:"price"`
}

type StakeRequest struct {
	Asset    string          `json:"asset"`
	Amount   decimal.Decimal `json:"amount"`
	APY      float64         `json:"apy"`
	Locked   bool            `json:"locked"`
	LockDays int             `json:"lock_days,omitempty"`
}

// Price data from external API (transient; not persisted as NUMERIC).
type PriceData struct {
	Symbol    string  `json:"symbol"`
	Price     float64 `json:"price"`
	Change24h float64 `json:"change_24h"`
	Volume24h float64 `json:"volume_24h"`
	MarketCap float64 `json:"market_cap"`
}
