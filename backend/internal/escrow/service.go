package escrow

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/kiramopay/backend/internal/audit"
	"github.com/kiramopay/backend/internal/ledger"
)

// MFAEnforcer gates high-value funding, same contract as transfers.
type MFAEnforcer interface {
	IsMFARequired(amountMinor int64, currency string) bool
	HasVerifiedMFA(ctx context.Context, userID, purpose string) (bool, error)
}

// UIFReporter is notified, best-effort, after funding posts (AML thresholds).
type UIFReporter interface {
	Report(ctx context.Context, userID, txID, currency string, amountMinor int64)
}

// EventSink receives lifecycle events (escrow.funded, escrow.released, …) for
// fan-out to merchant webhooks. Best-effort: emitting never fails the
// business operation.
type EventSink interface {
	Emit(ctx context.Context, userID, eventType string, payload any)
}

// Service drives the escrow state machine and its ledger postings.
type Service struct {
	repo        *Repository
	ledger      *ledger.Engine
	mfa         MFAEnforcer
	uif         UIFReporter
	events      EventSink
	auditLogger *audit.Logger
}

// Options carries the optional collaborators.
type Options struct {
	MFA         MFAEnforcer
	UIF         UIFReporter
	Events      EventSink
	AuditLogger *audit.Logger
}

func NewService(repo *Repository, eng *ledger.Engine, opts *Options) *Service {
	if opts == nil {
		opts = &Options{}
	}
	return &Service{
		repo:        repo,
		ledger:      eng,
		mfa:         opts.MFA,
		uif:         opts.UIF,
		events:      opts.Events,
		auditLogger: opts.AuditLogger,
	}
}

// emit notifies both parties' webhook endpoints about a lifecycle event.
func (s *Service) emit(ctx context.Context, a *Agreement, eventType string) {
	if s.events == nil {
		return
	}
	s.events.Emit(ctx, a.BuyerID, eventType, a)
	s.events.Emit(ctx, a.SellerID, eventType, a)
}

// Create opens a pending agreement with the caller as buyer. No money moves.
func (s *Service) Create(ctx context.Context, buyerID string, req *CreateRequest) (*Agreement, error) {
	if req == nil || req.SellerID == "" || req.AmountMinor <= 0 ||
		strings.TrimSpace(req.Description) == "" {
		return nil, ErrInvalidRequest
	}
	req.Currency = strings.ToUpper(strings.TrimSpace(req.Currency))
	if req.Currency == "" {
		req.Currency = "CRC"
	}
	if req.Currency != "CRC" && req.Currency != "USD" {
		return nil, ErrInvalidRequest
	}
	if req.SellerID == buyerID {
		return nil, ErrInvalidRequest
	}
	a, err := s.repo.Create(ctx, buyerID, req)
	if err != nil {
		return nil, fmt.Errorf("create agreement: %w", err)
	}
	s.audit(buyerID, a, "escrow_created", "low", nil)
	s.emit(ctx, a, "escrow.created")
	return a, nil
}

// Get returns the agreement if the viewer is a party to it.
func (s *Service) Get(ctx context.Context, viewerID, id string) (*Agreement, error) {
	a, err := s.repo.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	if a.BuyerID != viewerID && a.SellerID != viewerID {
		return nil, ErrNotParty
	}
	return a, nil
}

// List returns the viewer's agreements (as buyer or seller).
func (s *Service) List(ctx context.Context, viewerID string, limit int) ([]Agreement, error) {
	return s.repo.ListByUser(ctx, viewerID, limit)
}

// Fund locks the buyer's money into SYSTEM:ESCROW (pending → funded).
func (s *Service) Fund(ctx context.Context, callerID, id string) (*Agreement, error) {
	a, err := s.repo.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	if a.BuyerID != callerID {
		if a.SellerID == callerID {
			return nil, ErrNotBuyer
		}
		return nil, ErrNotParty
	}
	if a.Status != StatusPending {
		return nil, ErrBadTransition
	}

	bal, err := s.repo.WalletBalance(ctx, a.BuyerID, a.Currency)
	if err != nil {
		return nil, fmt.Errorf("balance check: %w", err)
	}
	if bal < a.AmountMinor {
		return nil, ErrInsufficient
	}

	if s.mfa != nil && s.mfa.IsMFARequired(a.AmountMinor, a.Currency) {
		ok, err := s.mfa.HasVerifiedMFA(ctx, a.BuyerID, "high_value_tx")
		if err != nil {
			return nil, fmt.Errorf("mfa check: %w", err)
		}
		if !ok {
			return nil, ErrMFARequired
		}
	}

	return s.moveAndTransition(ctx, a, StatusPending, StatusFunded, "fund",
		ledger.Account{UserID: a.BuyerID}, escrowAccount(a.Currency),
		func(done *Agreement) {
			if s.uif != nil {
				s.uif.Report(ctx, a.BuyerID, a.ID, a.Currency, a.AmountMinor)
			}
		})
}

// Release pays the held funds out to the seller (funded → released, buyer only).
func (s *Service) Release(ctx context.Context, callerID, id string) (*Agreement, error) {
	a, err := s.repo.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	if a.BuyerID != callerID {
		if a.SellerID == callerID {
			return nil, ErrNotBuyer
		}
		return nil, ErrNotParty
	}
	return s.moveAndTransition(ctx, a, StatusFunded, StatusReleased, "release",
		escrowAccount(a.Currency), ledger.Account{UserID: a.SellerID}, nil)
}

// Refund returns the held funds to the buyer (funded → refunded, seller only —
// the seller waiving the sale).
func (s *Service) Refund(ctx context.Context, callerID, id string) (*Agreement, error) {
	a, err := s.repo.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	if a.SellerID != callerID {
		if a.BuyerID == callerID {
			return nil, ErrNotSeller
		}
		return nil, ErrNotParty
	}
	return s.moveAndTransition(ctx, a, StatusFunded, StatusRefunded, "refund",
		escrowAccount(a.Currency), ledger.Account{UserID: a.BuyerID}, nil)
}

// Dispute freezes a funded agreement pending admin resolution (either party).
func (s *Service) Dispute(ctx context.Context, callerID, id, reason string) (*Agreement, error) {
	a, err := s.repo.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	if a.BuyerID != callerID && a.SellerID != callerID {
		return nil, ErrNotParty
	}
	if strings.TrimSpace(reason) == "" {
		return nil, ErrInvalidRequest
	}
	out, err := s.repo.Transition(ctx, id, StatusFunded, StatusDisputed, reason)
	if err != nil {
		return nil, err
	}
	s.audit(callerID, out, "escrow_disputed", "medium", map[string]interface{}{"reason": reason})
	s.emit(ctx, out, "escrow.disputed")
	return out, nil
}

// Cancel abandons a pending (unfunded) agreement (either party). No money moves.
func (s *Service) Cancel(ctx context.Context, callerID, id string) (*Agreement, error) {
	a, err := s.repo.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	if a.BuyerID != callerID && a.SellerID != callerID {
		return nil, ErrNotParty
	}
	out, err := s.repo.Transition(ctx, id, StatusPending, StatusCancelled, "")
	if err != nil {
		return nil, err
	}
	s.audit(callerID, out, "escrow_cancelled", "low", nil)
	s.emit(ctx, out, "escrow.cancelled")
	return out, nil
}

// Resolve settles a disputed agreement (admin only — enforced at the route).
// outcome must be "released" (pay seller) or "refunded" (return to buyer).
func (s *Service) Resolve(ctx context.Context, adminID, id string, outcome Status) (*Agreement, error) {
	a, err := s.repo.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	switch outcome {
	case StatusReleased:
		return s.moveAndTransition(ctx, a, StatusDisputed, StatusReleased, "release",
			escrowAccount(a.Currency), ledger.Account{UserID: a.SellerID},
			func(done *Agreement) {
				s.audit(adminID, done, "escrow_resolved", "high",
					map[string]interface{}{"outcome": "released"})
			})
	case StatusRefunded:
		return s.moveAndTransition(ctx, a, StatusDisputed, StatusRefunded, "refund",
			escrowAccount(a.Currency), ledger.Account{UserID: a.BuyerID},
			func(done *Agreement) {
				s.audit(adminID, done, "escrow_resolved", "high",
					map[string]interface{}{"outcome": "refunded"})
			})
	default:
		return nil, ErrInvalidRequest
	}
}

// moveAndTransition is the money-moving core. Order matters:
//
//  1. CLAIM the state transition (UPDATE ... WHERE status = from). This is the
//     mutex — of two concurrent money-moving actions (e.g. buyer Release vs
//     seller Refund) exactly one wins; the loser gets ErrBadTransition and no
//     second posting can happen.
//  2. POST the double-entry. The posting carries a deterministic idempotency
//     key ("escrow:<action>:<id>"), so a retry after a crash can never move
//     money twice.
//  3. On posting failure, COMPENSATE by reverting the claim. If even the
//     revert fails we log+audit at high severity for manual reconciliation —
//     status-without-money is detectable and fixable; money-without-status
//     (double movement) would not be, which is why the claim goes first.
func (s *Service) moveAndTransition(
	ctx context.Context, a *Agreement, from, to Status, action string,
	debit, credit ledger.Account, onSuccess func(*Agreement),
) (*Agreement, error) {
	claimed, err := s.repo.Transition(ctx, a.ID, from, to, "")
	if err != nil {
		return nil, err
	}

	_, err = s.ledger.Post(ctx, &ledger.Posting{
		Description:    fmt.Sprintf("escrow %s: %s", action, a.ID),
		IdempotencyKey: fmt.Sprintf("escrow:%s:%s", action, a.ID),
		CreatedBy:      a.BuyerID,
		Metadata: map[string]any{
			"escrow_id": a.ID,
			"action":    action,
		},
		Entries: []ledger.Entry{
			{Account: debit, Side: ledger.Debit, AmountMinor: a.AmountMinor, Currency: a.Currency},
			{Account: credit, Side: ledger.Credit, AmountMinor: a.AmountMinor, Currency: a.Currency},
		},
	})
	if err != nil && !errors.Is(err, ledger.ErrIdempotent) {
		if _, rerr := s.repo.Transition(ctx, a.ID, to, from, ""); rerr != nil {
			s.audit(a.BuyerID, claimed, "escrow_compensation_failed", "high",
				map[string]interface{}{"action": action, "post_error": err.Error(), "revert_error": rerr.Error()})
		}
		return nil, fmt.Errorf("escrow %s posting: %w", action, err)
	}

	s.audit(a.BuyerID, claimed, "escrow_"+string(to), "medium", nil)
	s.emit(ctx, claimed, "escrow."+string(to))
	if onSuccess != nil {
		onSuccess(claimed)
	}
	return claimed, nil
}

func escrowAccount(currency string) ledger.Account {
	if currency == "USD" {
		return ledger.Account{SystemCode: ledger.SystemEscrowUSD}
	}
	return ledger.Account{SystemCode: ledger.SystemEscrowCRC}
}

func (s *Service) audit(actorID string, a *Agreement, action, risk string, extra map[string]interface{}) {
	if s.auditLogger == nil {
		return
	}
	details := map[string]interface{}{
		"buyer_id":     a.BuyerID,
		"seller_id":    a.SellerID,
		"amount_minor": a.AmountMinor,
		"currency":     a.Currency,
		"status":       string(a.Status),
	}
	for k, v := range extra {
		details[k] = v
	}
	s.auditLogger.Log(audit.Event{
		UserID:       actorID,
		Action:       action,
		ResourceType: "escrow",
		ResourceID:   a.ID,
		Details:      details,
		RiskLevel:    risk,
	})
}
