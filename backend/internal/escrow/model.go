// Package escrow implements buyer-funded, ledger-backed payment holds.
//
// An agreement moves through a strict state machine; every state that moves
// money does it through the double-entry ledger against the SYSTEM:ESCROW
// liability account, so escrow balances are provable from the journal:
//
//	pending ──fund──▶ funded ──release──▶ released   (buyer → escrow → seller)
//	   │                │ ├────refund───▶ refunded   (escrow → buyer)
//	   └──cancel──▶ cancelled └─dispute─▶ disputed ──resolve──▶ released|refunded
package escrow

import (
	"errors"
	"time"
)

// Status is the workflow state of an agreement.
type Status string

const (
	StatusPending   Status = "pending"   // created, not yet funded — no money moved
	StatusFunded    Status = "funded"    // buyer's funds held in SYSTEM:ESCROW
	StatusReleased  Status = "released"  // funds delivered to the seller
	StatusRefunded  Status = "refunded"  // funds returned to the buyer
	StatusDisputed  Status = "disputed"  // frozen pending admin resolution
	StatusCancelled Status = "cancelled" // abandoned before funding
)

// validTransitions is the single source of truth for the state machine.
var validTransitions = map[Status][]Status{
	StatusPending:  {StatusFunded, StatusCancelled},
	StatusFunded:   {StatusReleased, StatusRefunded, StatusDisputed},
	StatusDisputed: {StatusReleased, StatusRefunded},
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

// Agreement is one escrow contract between a buyer and a seller.
type Agreement struct {
	ID            string     `json:"id"`
	BuyerID       string     `json:"buyer_id"`
	SellerID      string     `json:"seller_id"`
	AmountMinor   int64      `json:"amount_minor"`
	Currency      string     `json:"currency"`
	Status        Status     `json:"status"`
	Description   string     `json:"description"`
	DisputeReason string     `json:"dispute_reason,omitempty"`
	FundedAt      *time.Time `json:"funded_at,omitempty"`
	ReleasedAt    *time.Time `json:"released_at,omitempty"`
	RefundedAt    *time.Time `json:"refunded_at,omitempty"`
	DisputedAt    *time.Time `json:"disputed_at,omitempty"`
	CancelledAt   *time.Time `json:"cancelled_at,omitempty"`
	CreatedAt     time.Time  `json:"created_at"`
	UpdatedAt     time.Time  `json:"updated_at"`
}

// CreateRequest is the payload to open an agreement.
type CreateRequest struct {
	SellerID    string `json:"seller_id"`
	AmountMinor int64  `json:"amount_minor"`
	Currency    string `json:"currency"`
	Description string `json:"description"`
}

// Domain errors mapped to HTTP statuses by the handler.
var (
	ErrNotFound       = errors.New("escrow: agreement not found")
	ErrNotParty       = errors.New("escrow: caller is not a party to this agreement")
	ErrNotBuyer       = errors.New("escrow: only the buyer may perform this action")
	ErrNotSeller      = errors.New("escrow: only the seller may perform this action")
	ErrBadTransition  = errors.New("escrow: action not allowed in the current status")
	ErrInsufficient   = errors.New("escrow: insufficient balance")
	ErrMFARequired    = errors.New("escrow: verified MFA challenge required for this amount")
	ErrInvalidRequest = errors.New("escrow: invalid request")
)
