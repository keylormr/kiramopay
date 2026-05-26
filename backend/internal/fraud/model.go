package fraud

import "time"

// ── Risk Assessment ──────────────────────────────────────────────────────────

type RiskAssessment struct {
	ID          string    `json:"id"`
	UserID      string    `json:"user_id"`
	TxType      string    `json:"tx_type"` // transaction, sinpe, qr_payment, crypto, card
	TxID        string    `json:"tx_id"`
	Amount      int64     `json:"amount"` // centimos
	RiskScore   int       `json:"risk_score"` // 0-100
	RiskLevel   string    `json:"risk_level"` // low, medium, high, critical
	Factors     []string  `json:"factors"`    // reasons for the score
	Action      string    `json:"action"`     // allow, review, block
	ReviewedBy  string    `json:"reviewed_by,omitempty"`
	ReviewedAt  *time.Time `json:"reviewed_at,omitempty"`
	CreatedAt   time.Time `json:"created_at"`
}

// Risk thresholds
const (
	LowThreshold      = 25
	MediumThreshold    = 50
	HighThreshold      = 75
	CriticalThreshold  = 90

	ActionAllow  = "allow"
	ActionReview = "review"
	ActionBlock  = "block"
)

// ── Fraud Rule ───────────────────────────────────────────────────────────────

type FraudRule struct {
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	Description string  `json:"description"`
	Category    string  `json:"category"` // velocity, amount, pattern, device, location
	Condition   string  `json:"condition"` // JSON-encoded rule logic
	ScoreWeight int     `json:"score_weight"` // points added to risk score
	Active      bool    `json:"active"`
}

// ── Fraud Alert ──────────────────────────────────────────────────────────────

type FraudAlert struct {
	ID           string     `json:"id"`
	UserID       string     `json:"user_id"`
	AssessmentID string     `json:"assessment_id"`
	Type         string     `json:"type"` // suspicious_tx, velocity_breach, amount_anomaly, device_change
	Severity     string     `json:"severity"` // low, medium, high, critical
	Message      string     `json:"message"`
	Status       string     `json:"status"` // open, investigating, resolved, false_positive
	ResolvedBy   string     `json:"resolved_by,omitempty"`
	ResolvedAt   *time.Time `json:"resolved_at,omitempty"`
	CreatedAt    time.Time  `json:"created_at"`
}

// ── User Risk Profile ────────────────────────────────────────────────────────

type UserRiskProfile struct {
	ID                string    `json:"id"`
	UserID            string    `json:"user_id"`
	OverallRiskScore  int       `json:"overall_risk_score"` // 0-100
	TotalTransactions int64     `json:"total_transactions"`
	TotalFlagged      int64     `json:"total_flagged"`
	AvgTxAmount       int64     `json:"avg_tx_amount"` // centimos
	MaxTxAmount       int64     `json:"max_tx_amount"` // centimos
	LastActivityAt    time.Time `json:"last_activity_at"`
	AccountAge        int       `json:"account_age_days"`
	IsRestricted      bool      `json:"is_restricted"`
	UpdatedAt         time.Time `json:"updated_at"`
}

// ── Assessment Request ───────────────────────────────────────────────────────

type AssessRequest struct {
	UserID    string `json:"user_id"`
	TxType    string `json:"tx_type"`
	TxID      string `json:"tx_id"`
	Amount    int64  `json:"amount"`
	Currency  string `json:"currency"`
	Recipient string `json:"recipient,omitempty"`
	DeviceID  string `json:"device_id,omitempty"`
	IPAddress string `json:"ip_address,omitempty"`
}
