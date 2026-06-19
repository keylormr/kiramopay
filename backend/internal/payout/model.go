// Package payout implements ledger-backed outbound payments over pluggable
// "rails". A rail is any settlement network money can leave the platform
// through (SINPE participant, dLocal, Circle/USDC, …); adding one is a matter
// of implementing Rail and registering it — the orchestration, accounting,
// idempotency and compliance gates live here, once.
//
// Money flow is pure double-entry against a per-rail system liability account,
// so payout balances are provable from the journal:
//
//	submit:  debit user wallet            / credit SYSTEM:EXTERNAL:<RAIL>:<CUR>
//	refund:  debit SYSTEM:EXTERNAL:<RAIL> / credit user wallet   (rail rejected)
//
// The payouts row is workflow state; the journal is the truth. The state
// machine is strict and every money-moving transition is claimed (a guarded
// UPDATE) before it posts, so two concurrent actions can never double-move.
//
//	pending ──submit──▶ processing ──┬─settle──▶ completed   (rail accepted & settled)
//	   ▲                             ├─reject──▶ failed       (rail rejected, money refunded)
//	   └───────revert───────────────┘                        (debit failed: safe to retry)
package payout

import (
	"errors"
	"time"
)

// Status is the workflow state of a payout.
type Status string

const (
	StatusPending    Status = "pending"    // created, validated — no money moved yet
	StatusProcessing Status = "processing" // user debited, funds held in SYSTEM:EXTERNAL, awaiting settlement
	StatusCompleted  Status = "completed"  // rail confirmed settlement at the destination
	StatusFailed     Status = "failed"     // rail rejected; funds refunded to the user
)

// validTransitions is the single source of truth for the state machine.
// processing→pending is the compensating revert for a failed debit (safe to
// retry); completed and failed are terminal.
var validTransitions = map[Status][]Status{
	StatusPending:    {StatusProcessing},
	StatusProcessing: {StatusCompleted, StatusFailed, StatusPending},
}

// CanTransition reports whether moving from → to is allowed.
func CanTransition(from, to Status) bool {
	for _, t := range validTransitions[from] {
		if t == to {
			return true
		}
	}
	return false
}

// Destination is a rail-typed beneficiary. Different rails read different
// fields (a bank rail needs Account+Bank; a phone rail needs Account as the
// number; a crypto rail needs Account as the address) — the rail validates its
// own requirements in Rail.Send, so the domain stays rail-agnostic.
type Destination struct {
	Type    string `json:"type"`              // e.g. "bank_account", "sinpe_phone", "crypto_address"
	Account string `json:"account"`           // account number / IBAN / phone / address
	Name    string `json:"name"`              // beneficiary name
	Bank    string `json:"bank,omitempty"`    // bank/institution code, when applicable
	Country string `json:"country,omitempty"` // ISO-3166 alpha-2, when applicable
}

// MaskedAccount returns the destination account with all but the last four
// characters redacted, for audit logs and other low-trust sinks.
func (d Destination) MaskedAccount() string {
	a := d.Account
	if len(a) <= 4 {
		return "****"
	}
	return "****" + a[len(a)-4:]
}

// Payout is one outbound payment request and its lifecycle.
type Payout struct {
	ID             string      `json:"id"`
	UserID         string      `json:"user_id"`
	Rail           string      `json:"rail"`
	AmountMinor    int64       `json:"amount_minor"`
	Currency       string      `json:"currency"`
	Status         Status      `json:"status"`
	Destination    Destination `json:"destination"`
	ExternalID     string      `json:"external_id,omitempty"`     // id assigned by the rail, once known
	FailureReason  string      `json:"failure_reason,omitempty"`  // rail's rejection reason
	IdempotencyKey string      `json:"idempotency_key,omitempty"` // caller-supplied dedupe key
	ProcessingAt   *time.Time  `json:"processing_at,omitempty"`
	CompletedAt    *time.Time  `json:"completed_at,omitempty"`
	FailedAt       *time.Time  `json:"failed_at,omitempty"`
	CreatedAt      time.Time   `json:"created_at"`
	UpdatedAt      time.Time   `json:"updated_at"`
}

// CreateRequest is the payload to open and submit a payout.
type CreateRequest struct {
	Rail           string      `json:"rail"`
	AmountMinor    int64       `json:"amount_minor"`
	Currency       string      `json:"currency"`
	Destination    Destination `json:"destination"`
	IdempotencyKey string      `json:"idempotency_key"`
}

// Domain errors mapped to HTTP statuses by the handler.
var (
	ErrNotFound       = errors.New("payout: not found")
	ErrNotOwner       = errors.New("payout: caller does not own this payout")
	ErrUnknownRail    = errors.New("payout: unknown rail")
	ErrBadTransition  = errors.New("payout: action not allowed in the current status")
	ErrInsufficient   = errors.New("payout: insufficient balance")
	ErrMFARequired    = errors.New("payout: verified MFA challenge required for this amount")
	ErrInvalidRequest = errors.New("payout: invalid request")
)
