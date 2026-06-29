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
	g, err := s.repo.Get(ctx, id, userID)
	if err != nil {
		return err
	}
	if g.SavedMinor > 0 {
		if _, err := s.move(ctx, userID, g, g.SavedMinor, false); err != nil {
			return err
		}
	}
	return s.repo.Delete(ctx, id, userID)
}

func (s *Service) Deposit(ctx context.Context, userID, id string, amount int64) (*Goal, error) {
	if amount <= 0 {
		return nil, fmt.Errorf("amount must be positive")
	}
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
	return s.move(ctx, userID, g, amount, true)
}

func (s *Service) Withdraw(ctx context.Context, userID, id string, amount int64) (*Goal, error) {
	if amount <= 0 {
		return nil, fmt.Errorf("amount must be positive")
	}
	g, err := s.repo.Get(ctx, id, userID)
	if err != nil {
		return nil, err
	}
	if g.SavedMinor < amount {
		return nil, fmt.Errorf("amount exceeds amount saved")
	}
	return s.move(ctx, userID, g, amount, false)
}

// move posts the balanced ledger transfer between the wallet and SYSTEM:SAVINGS
// and updates the goal. deposit=true: wallet -> savings; false: savings -> wallet.
func (s *Service) move(ctx context.Context, userID string, g *Goal, amount int64, deposit bool) (*Goal, error) {
	savingsAcct := ledger.Account{SystemCode: ledger.SystemSavingsCRC}
	if g.Currency == "USD" {
		savingsAcct = ledger.Account{SystemCode: ledger.SystemSavingsUSD}
	}
	userAcct := ledger.Account{UserID: userID}

	debit, credit := userAcct, savingsAcct
	delta := amount
	txType := transaction.TypeSavingsDeposit
	desc := "savings deposit: " + g.Name
	if !deposit {
		debit, credit = savingsAcct, userAcct
		delta = -amount
		txType = transaction.TypeSavingsWithdraw
		desc = "savings withdraw: " + g.Name
	}

	postID := uuid.NewString()
	if _, err := s.ledger.Post(ctx, &ledger.Posting{
		Description:    desc,
		IdempotencyKey: "savings:" + postID,
		TxID:           postID,
		CreatedBy:      userID,
		Entries: []ledger.Entry{
			{Account: debit, Side: ledger.Debit, AmountMinor: amount, Currency: g.Currency},
			{Account: credit, Side: ledger.Credit, AmountMinor: amount, Currency: g.Currency},
		},
	}); err != nil {
		return nil, fmt.Errorf("savings ledger post: %w", err)
	}

	updated, err := s.repo.AddSaved(ctx, g.ID, userID, delta)
	if err != nil {
		return nil, err
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
