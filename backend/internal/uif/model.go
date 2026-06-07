package uif

import "time"

// Report types.
const (
	TypeSingleThreshold = "single_threshold" // one tx >= ceiling
	TypeStructuring     = "structuring"      // same-day aggregate crosses ceiling
	TypeManual          = "manual"           // flagged by a compliance officer
)

// Report statuses.
const (
	StatusPending   = "pending"
	StatusReviewed  = "reviewed"
	StatusSubmitted = "submitted"
	StatusDismissed = "dismissed"
)

// Report is one entry in the UIF review queue.
type Report struct {
	ID              string     `json:"id"`
	UserID          string     `json:"user_id"`
	TxID            string     `json:"tx_id,omitempty"`
	ReportType      string     `json:"report_type"`
	AmountMinor     int64      `json:"amount_minor"`
	Currency        string     `json:"currency"`
	DailyTotalMinor int64      `json:"daily_total_minor"`
	Reason          string     `json:"reason"`
	Status          string     `json:"status"`
	ReviewerID      string     `json:"reviewer_id,omitempty"`
	ReviewerNotes   string     `json:"reviewer_notes,omitempty"`
	CreatedAt       time.Time  `json:"created_at"`
	ReviewedAt      *time.Time `json:"reviewed_at,omitempty"`
}

// ReviewRequest is a compliance officer's decision on a pending report.
type ReviewRequest struct {
	Status string `json:"status"` // submitted | dismissed | reviewed
	Notes  string `json:"notes,omitempty"`
}
