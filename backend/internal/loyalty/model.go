package loyalty

import "time"

// ── Points Account ───────────────────────────────────────────────────────────

type PointsAccount struct {
	ID             string    `json:"id"`
	UserID         string    `json:"user_id"`
	TotalPoints    int64     `json:"total_points"`
	AvailablePoints int64   `json:"available_points"`
	LifetimePoints int64    `json:"lifetime_points"`
	Tier           string    `json:"tier"` // bronze, silver, gold, platinum
	UpdatedAt      time.Time `json:"updated_at"`
}

// Tier thresholds (lifetime points)
const (
	TierBronze   = "bronze"
	TierSilver   = "silver"
	TierGold     = "gold"
	TierPlatinum = "platinum"

	SilverThreshold   = 5000
	GoldThreshold     = 25000
	PlatinumThreshold = 100000
)

// ── Points Transaction ───────────────────────────────────────────────────────

type PointsTransaction struct {
	ID          string    `json:"id"`
	UserID      string    `json:"user_id"`
	Type        string    `json:"type"` // earn, redeem, expire, bonus
	Points      int64     `json:"points"`
	Description string    `json:"description"`
	RefType     string    `json:"ref_type,omitempty"` // transaction, sinpe, service, ride, food_order
	RefID       string    `json:"ref_id,omitempty"`
	CreatedAt   time.Time `json:"created_at"`
}

// ── Cashback Rule ────────────────────────────────────────────────────────────

type CashbackRule struct {
	ID         string  `json:"id"`
	Category   string  `json:"category"` // transaction, sinpe, service, marketplace, crypto
	Percentage float64 `json:"percentage"`
	MaxPoints  int64   `json:"max_points_per_tx"`
	Active     bool    `json:"active"`
	TierBonus  map[string]float64 `json:"tier_bonus,omitempty"` // extra % per tier
}

// ── Reward ───────────────────────────────────────────────────────────────────

type Reward struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	Category    string    `json:"category"` // discount, voucher, gift_card, experience
	PointsCost  int64     `json:"points_cost"`
	ImageURL    string    `json:"image_url"`
	PartnerCode string    `json:"partner_code,omitempty"`
	Active      bool      `json:"active"`
	Stock       int       `json:"stock"` // -1 = unlimited
	ExpiresAt   *time.Time `json:"expires_at,omitempty"`
	CreatedAt   time.Time `json:"created_at"`
}

// ── Redemption ───────────────────────────────────────────────────────────────

type Redemption struct {
	ID        string    `json:"id"`
	UserID    string    `json:"user_id"`
	RewardID  string    `json:"reward_id"`
	Points    int64     `json:"points"`
	Status    string    `json:"status"` // pending, completed, cancelled
	Code      string    `json:"code,omitempty"` // voucher/discount code
	CreatedAt time.Time `json:"created_at"`
}

// ── Request DTOs ─────────────────────────────────────────────────────────────

type EarnPointsRequest struct {
	RefType string `json:"ref_type"`
	RefID   string `json:"ref_id"`
	Amount  int64  `json:"amount"` // transaction amount in centimos
}

type RedeemRewardRequest struct {
	RewardID string `json:"reward_id"`
}
