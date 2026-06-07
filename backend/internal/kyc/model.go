package kyc

import (
	"strings"
	"time"
)

// KYC levels (mirrors users.kyc_level).
const (
	LevelBasic    = 0 // unverified — minimal limits
	LevelVerified = 1 // ID verified
	LevelComplete = 2 // ID + proof of address
)

// Verification statuses.
const (
	StatusPending      = "pending"
	StatusApproved     = "approved"
	StatusRejected     = "rejected"
	StatusScreeningHit = "screening_hit"
)

// Screening results.
const (
	ScreenPending = "pending"
	ScreenClean   = "clean"
	ScreenHit     = "hit"
	ScreenError   = "error"
)

// LevelLimits maps a KYC level to wallet daily/monthly limits in centimos.
// Unverified users are deliberately constrained; verification raises the cap.
type Limits struct {
	DailyMinor   int64
	MonthlyMinor int64
}

var LevelLimits = map[int]Limits{
	LevelBasic:    {DailyMinor: 10_000_000, MonthlyMinor: 50_000_000},     // ₡100k / ₡500k
	LevelVerified: {DailyMinor: 50_000_000, MonthlyMinor: 500_000_000},    // ₡500k / ₡5M
	LevelComplete: {DailyMinor: 200_000_000, MonthlyMinor: 2_000_000_000}, // ₡2M / ₡20M
}

// Verification is one KYC submission + its review state.
type Verification struct {
	ID              string     `json:"id"`
	UserID          string     `json:"user_id"`
	LevelRequested  int        `json:"level_requested"`
	Status          string     `json:"status"`
	FullLegalName   string     `json:"full_legal_name"`
	BirthDate       *time.Time `json:"birth_date,omitempty"`
	Nationality     string     `json:"nationality,omitempty"`
	DocumentType    string     `json:"document_type"`
	DocumentNumber  string     `json:"document_number"`
	ScreeningResult string     `json:"screening_result"`
	ReviewerNotes   string     `json:"reviewer_notes,omitempty"`
	DecidedBy       string     `json:"decided_by,omitempty"`
	SubmittedAt     time.Time  `json:"submitted_at"`
	DecidedAt       *time.Time `json:"decided_at,omitempty"`
}

// Document is a reference (object-store key) + integrity hash. The raw bytes
// are NEVER stored in the database.
type Document struct {
	DocType string `json:"doc_type"`
	FileRef string `json:"file_ref"`
	SHA256  string `json:"sha256,omitempty"`
}

// SanctionMatch is one hit from the watchlist.
type SanctionMatch struct {
	ID       string `json:"id"`
	Source   string `json:"source"`
	FullName string `json:"full_name"`
	Program  string `json:"program,omitempty"`
}

// ScreenResult is the outcome of a sanction screen.
type ScreenResult struct {
	Result  string          `json:"result"` // clean, hit, error
	Matches []SanctionMatch `json:"matches,omitempty"`
}

// ── Request DTOs ─────────────────────────────────────────────────────────────

type SubmitRequest struct {
	LevelRequested int        `json:"level_requested"`
	FullLegalName  string     `json:"full_legal_name"`
	BirthDate      *time.Time `json:"birth_date,omitempty"`
	Nationality    string     `json:"nationality,omitempty"`
	DocumentType   string     `json:"document_type"`
	DocumentNumber string     `json:"document_number"`
	Documents      []Document `json:"documents,omitempty"`
}

type DecisionRequest struct {
	Approve bool   `json:"approve"`
	Notes   string `json:"notes,omitempty"`
}

type StatusResponse struct {
	KYCLevel  int           `json:"kyc_level"`
	KYCStatus string        `json:"kyc_status"`
	Limits    Limits        `json:"limits"`
	Latest    *Verification `json:"latest_verification,omitempty"`
}

// normalizeName lowercases, trims and collapses internal whitespace so that
// "  José  Pérez " and "jose pérez" screen consistently. (Accent folding is a
// production enhancement; kept minimal here.)
func normalizeName(s string) string {
	return strings.Join(strings.Fields(strings.ToLower(strings.TrimSpace(s))), " ")
}
