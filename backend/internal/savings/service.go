package savings

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/kiramopay/backend/internal/ledger"
	"github.com/kiramopay/backend/internal/transaction"
)

// HistoryRecorder makes savings money movements visible in the user's
// transaction list. Best-effort: failing to record never fails the movement.
type HistoryRecorder interface {
	RecordHistory(ctx context.Context, userID string, req *transaction.CreateTransactionRequest) error
}

type Service struct {
	repo    *Repository
	ledger  *ledger.Engine
	history HistoryRecorder
}

func NewService(repo *Repository, eng *ledger.Engine, history HistoryRecorder) *Service {
	return &Service{repo: repo, ledger: eng, history: history}
}

func (s *Service) List(ctx context.Context, userID string) ([]Goal, error) {
	return s.repo.ListByUser(ctx, userID)
}

func (s *Service) Create(ctx context.Context, userID string, req *CreateGoalRequest) (*Goal, error) {
	if req.Name == "" {
		return nil, fmt.Errorf("name is required")
	}
	if req.TargetMinor <= 0 {
		return nil, fmt.Errorf("target must be positive")
	}
	currency := req.Currency
	if currency == "" {
		currency = "CRC"
	}
	if currency != "CRC" && currency != "USD" {
		return nil, fmt.Errorf("invalid currency")
	}
	icon := req.Icon
	if icon == "" {
		icon = "piggy-bank"
	}
	g := &Goal{
		UserID:      userID,
		Name:        req.Name,
		TargetMinor: req.TargetMinor,
		Currency:    currency,
		Icon:        icon,
		Color:       req.Color,
	}
	if err := s.repo.Create(ctx, g); err != nil {
		return nil, err
	}
	return g, nil
}

// Delete refunds any held savings back to the wallet, then removes the goal — so
// money is never stranded in SYSTEM:SAVINGS.
func (s *Service) Delete(ctx context.Context, userID, id string) error {
	unlock, err := s.repo.AcquireUserSavingsLock(ctx, userID)
	if err != nil {
		return err
	}
	defer unlock()
	g, err := s.repo.Get(ctx, id, userID)
	if err != nil {
		return err
	}
	if g.SavedMinor > 0 {
		if _, err := s.move(ctx, userID, g, g.SavedMinor, false, ""); err != nil {
			return err
		}
	}
	return s.repo.Delete(ctx, id, userID)
}

// Deposit/Withdraw accept an optional idemKey (the request's Idempotency-Key
// header). When set, an exact retry of the same request is a no-op instead of a
// second money movement.
func (s *Service) Deposit(ctx context.Context, userID, id string, amount int64, idemKey string) (*Goal, error) {
	if amount <= 0 {
		return nil, fmt.Errorf("amount must be positive")
	}
	unlock, err := s.repo.AcquireUserSavingsLock(ctx, userID)
	if err != nil {
		return nil, err
	}
	defer unlock()
	g, err := s.repo.Get(ctx, id, userID)
	if err != nil {
		return nil, err
	}
	bal, err := s.repo.WalletBalance(ctx, userID, g.Currency)
	if err != nil {
		return nil, fmt.Errorf("balance check: %w", err)
	}
	if bal < amount {
		return nil, fmt.Errorf("insufficient balance")
	}
	return s.move(ctx, userID, g, amount, true, idemKey)
}

func (s *Service) Withdraw(ctx context.Context, userID, id string, amount int64, idemKey string) (*Goal, error) {
	if amount <= 0 {
		return nil, fmt.Errorf("amount must be positive")
	}
	unlock, err := s.repo.AcquireUserSavingsLock(ctx, userID)
	if err != nil {
		return nil, err
	}
	defer unlock()
	g, err := s.repo.Get(ctx, id, userID)
	if err != nil {
		return nil, err
	}
	// The authoritative balance gate is the guarded DeductSaved inside move.
	return s.move(ctx, userID, g, amount, false, idemKey)
}

// move posts the balanced ledger transfer between the wallet and SYSTEM:SAVINGS
// and updates the goal. deposit=true: wallet -> savings; false: savings -> wallet.
//
// Ordering is deliberate so no path can fabricate money:
//   - Withdraw: the guarded saved_minor decrement runs BEFORE the (irreversible)
//     wallet credit. SYSTEM:SAVINGS has no floor, so saved_minor is the only gate;
//     claiming it first means two concurrent withdrawals can't double-credit.
//   - Deposit: the wallet debit (gated by the ledger's non-negative floor) runs
//     first, so an overdraft is impossible; saved_minor is then incremented.
//
// Callers hold AcquireUserSavingsLock, so the whole sequence is serialized per user.
func (s *Service) move(ctx context.Context, userID string, g *Goal, amount int64, deposit bool, idemKey string) (*Goal, error) {
	// Idempotent retry: a client-supplied key whose posting already exists means
	// this exact request was already applied — return the current goal unchanged
	// rather than moving the money a second time. Safe under the per-user lock.
	ledgerKey := "savings:" + uuid.NewString()
	if idemKey != "" {
		ledgerKey = "savings:" + idemKey
		done, err := s.ledger.PostingExists(ctx, ledgerKey)
		if err != nil {
			return nil, fmt.Errorf("idempotency check: %w", err)
		}
		if done {
			return g, nil
		}
	}

	savingsAcct := ledger.Account{SystemCode: ledger.SystemSavingsCRC}
	if g.Currency == "USD" {
		savingsAcct = ledger.Account{SystemCode: ledger.SystemSavingsUSD}
	}
	userAcct := ledger.Account{UserID: userID}

	debit, credit := userAcct, savingsAcct
	txType := transaction.TypeSavingsDeposit
	desc := "savings deposit: " + g.Name
	if !deposit {
		debit, credit = savingsAcct, userAcct
		txType = transaction.TypeSavingsWithdraw
		desc = "savings withdraw: " + g.Name
	}

	var updated *Goal
	if !deposit {
		// Claim the held funds atomically before any irreversible money movement.
		var err error
		if updated, err = s.repo.DeductSaved(ctx, g.ID, userID, amount); err != nil {
			return nil, err
		}
	}

	if _, err := s.ledger.Post(ctx, &ledger.Posting{
		Description:    desc,
		IdempotencyKey: ledgerKey,
		TxID:           uuid.NewString(),
		CreatedBy:      userID,
		Entries: []ledger.Entry{
			{Account: debit, Side: ledger.Debit, AmountMinor: amount, Currency: g.Currency},
			{Account: credit, Side: ledger.Credit, AmountMinor: amount, Currency: g.Currency},
		},
	}); err != nil {
		if !deposit {
			// Compensate the decrement: the wallet credit never happened.
			_, _ = s.repo.AddSaved(ctx, g.ID, userID, amount)
		}
		return nil, fmt.Errorf("savings ledger post: %w", err)
	}

	if deposit {
		var err error
		if updated, err = s.repo.AddSaved(ctx, g.ID, userID, amount); err != nil {
			return nil, err
		}
	}

	if s.history != nil {
		_ = s.history.RecordHistory(ctx, userID, &transaction.CreateTransactionRequest{
			Type:        txType,
			Amount:      amount,
			Currency:    g.Currency,
			Description: desc,
		})
	}
	return updated, nil
}
