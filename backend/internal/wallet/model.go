package wallet

import "time"

type WalletRecord struct {
	ID               string    `json:"id"`
	UserID           string    `json:"user_id"`
	BalanceCRC       int64     `json:"balance_crc"`
	BalanceUSD       int64     `json:"balance_usd"`
	DailyLimit       int64     `json:"daily_limit"`
	MonthlyLimit     int64     `json:"monthly_limit"`
	DailySpent       int64     `json:"daily_spent"`
	MonthlySpent     int64     `json:"monthly_spent"`
	Status           string    `json:"status"`
	Version          int       `json:"version"`
	CreatedAt        time.Time `json:"created_at"`
	UpdatedAt        time.Time `json:"updated_at"`
}

type BalanceResponse struct {
	CRC          int64  `json:"crc"`
	USD          int64  `json:"usd"`
	CRCFormatted string `json:"crc_formatted"`
	USDFormatted string `json:"usd_formatted"`
}
