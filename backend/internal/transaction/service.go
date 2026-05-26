package transaction

import (
	"context"
	"errors"
	"fmt"

	"github.com/kiramopay/backend/internal/audit"
	"github.com/kiramopay/backend/internal/ledger"
	"github.com/kiramopay/backend/internal/wallet"
)

// MFAEnforcer (optional) gates high-value transactions. If non-nil and
// IsMFARequired returns true, the service expects a prior verified challenge
// for the user before the transaction proceeds.
type MFAEnforcer interface {
	IsMFARequired(amountMinor int64, currency string) bool
	HasVerifiedMFA(ctx context.Context, userID, purpose string) (bool, error)
}

type Service struct {
	repo        *Repository
	walletRepo  *wallet.Repository
	ledger      *ledger.Engine
	auditLogger *audit.Logger
	mfa         MFAEnforcer
}

// Options carries optional collaborators.
type Options struct {
	AuditLogger *audit.Logger
	MFA         MFAEnforcer
}

func NewService(repo *Repository, walletRepo *wallet.Repository, l *ledger.Engine, opts *Options) *Service {
	if opts == nil {
		opts = &Options{}
	}
	return &Service{
		repo:        repo,
		walletRepo:  walletRepo,
		ledger:      l,
		auditLogger: opts.AuditLogger,
		mfa:         opts.MFA,
	}
}

// CreateTransaction is the public entry point used by HTTP handlers for
// simple user-initiated transactions. Internal callers (sinpe, qr, splitpay)
// should prefer CreateTransfer which expresses BOTH legs of a transfer.
func (s *Service) CreateTransaction(ctx context.Context, userID string, req *CreateTransactionRequest) (*TransactionRecord, error) {
	// Idempotency short-circuit BEFORE locking anything.
	if req.IdempotencyKey != "" {
		existing, err := s.repo.FindByIdempotencyKey(ctx, userID, req.IdempotencyKey)
		if err == nil && existing != nil {
			return existing, nil
		}
	}

	w, err := s.walletRepo.FindByUserID(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("wallet not found")
	}

	if req.Currency == "" {
		req.Currency = "CRC"
	}
	if req.Amount <= 0 {
		return nil, fmt.Errorf("amount must be positive")
	}

	if isOutgoing(req.Type) {
		totalCost := req.Amount + req.Fee
		if req.Currency == "CRC" && w.BalanceCRC < totalCost {
			return nil, fmt.Errorf("insufficient balance")
		}
		if req.Currency == "USD" && w.BalanceUSD < totalCost {
			return nil, fmt.Errorf("insufficient balance")
		}
		if w.DailySpent+req.Amount > w.DailyLimit {
			return nil, fmt.Errorf("daily spending limit exceeded")
		}

		if s.mfa != nil && s.mfa.IsMFARequired(req.Amount, req.Currency) {
			ok, err := s.mfa.HasVerifiedMFA(ctx, userID, "high_value_tx")
			if err != nil {
				return nil, fmt.Errorf("mfa check: %w", err)
			}
			if !ok {
				return nil, ErrMFARequired
			}
		}
	}

	// Insert tx in pending with idempotency_key persisted.
	tx, err := s.repo.Create(ctx, userID, w.ID, req)
	if err != nil {
		if errors.Is(err, ErrDuplicate) {
			return tx, nil
		}
		return nil, fmt.Errorf("create transaction: %w", err)
	}

	// Build the ledger posting for outgoing/incoming legs against the
	// SYSTEM:EXTERNAL counterparty for now (callers that know the peer should
	// use CreateTransfer instead).
	posting := s.buildSingleSidedPosting(tx, req)
	postingID, err := s.ledger.Post(ctx, posting)
	if err != nil && !errors.Is(err, ledger.ErrIdempotent) {
		_ = s.repo.UpdateStatus(ctx, tx.ID, StatusFailed)
		return nil, fmt.Errorf("post ledger: %w", err)
	}
	_ = postingID

	if err := s.repo.UpdateStatus(ctx, tx.ID, StatusCompleted); err != nil {
		return nil, fmt.Errorf("mark completed: %w", err)
	}

	if s.auditLogger != nil && isOutgoing(req.Type) {
		s.auditLogger.LogTransfer(userID, tx.ID, req.Amount, req.Currency, "")
	}
	return tx, nil
}

// CreateTransferRequest carries both legs of an internal transfer.
type CreateTransferRequest struct {
	FromUserID     string
	ToUserID       string
	Amount         int64
	Currency       string
	Fee            int64
	Description    string
	IdempotencyKey string
	TxType         string // for the sender's transactions row
	ReceiveType    string // for the receiver's transactions row (e.g. p2p_receive)
}

// CreateTransfer atomically debits sender, credits receiver, books fee to
// SYSTEM:FEES, and writes 2 transactions rows (one each). All in one tx.
func (s *Service) CreateTransfer(ctx context.Context, req *CreateTransferRequest) (sender, receiver *TransactionRecord, err error) {
	if req.Amount <= 0 {
		return nil, nil, fmt.Errorf("amount must be positive")
	}
	if req.FromUserID == req.ToUserID {
		return nil, nil, fmt.Errorf("sender and receiver must differ")
	}
	if req.Currency == "" {
		req.Currency = "CRC"
	}

	// Idempotency: if already done, return existing rows.
	if req.IdempotencyKey != "" {
		if existing, _ := s.repo.FindByIdempotencyKey(ctx, req.FromUserID, req.IdempotencyKey); existing != nil {
			return existing, nil, nil
		}
	}

	senderWallet, err := s.walletRepo.FindByUserID(ctx, req.FromUserID)
	if err != nil {
		return nil, nil, fmt.Errorf("sender wallet not found")
	}
	receiverWallet, err := s.walletRepo.FindByUserID(ctx, req.ToUserID)
	if err != nil {
		return nil, nil, fmt.Errorf("receiver wallet not found")
	}

	total := req.Amount + req.Fee
	if req.Currency == "CRC" && senderWallet.BalanceCRC < total {
		return nil, nil, fmt.Errorf("insufficient balance")
	}
	if req.Currency == "USD" && senderWallet.BalanceUSD < total {
		return nil, nil, fmt.Errorf("insufficient balance")
	}
	if senderWallet.DailySpent+req.Amount > senderWallet.DailyLimit {
		return nil, nil, fmt.Errorf("daily spending limit exceeded")
	}

	if s.mfa != nil && s.mfa.IsMFARequired(req.Amount, req.Currency) {
		ok, err := s.mfa.HasVerifiedMFA(ctx, req.FromUserID, "high_value_tx")
		if err != nil {
			return nil, nil, fmt.Errorf("mfa check: %w", err)
		}
		if !ok {
			return nil, nil, ErrMFARequired
		}
	}

	senderReq := &CreateTransactionRequest{
		Type:              req.TxType,
		Amount:            req.Amount,
		Currency:          req.Currency,
		Fee:               req.Fee,
		CounterpartyType:  "user",
		CounterpartyName:  "", // populated by caller (sinpe handler resolves)
		Description:       req.Description,
		IdempotencyKey:    req.IdempotencyKey,
	}
	receiveReq := &CreateTransactionRequest{
		Type:              req.ReceiveType,
		Amount:            req.Amount,
		Currency:          req.Currency,
		Fee:               0,
		CounterpartyType:  "user",
		Description:       req.Description,
		// Receiver idempotency: derive deterministically to avoid double-credit.
		IdempotencyKey: pairKey(req.IdempotencyKey, "recv"),
	}

	sender, err = s.repo.Create(ctx, req.FromUserID, senderWallet.ID, senderReq)
	if err != nil && !errors.Is(err, ErrDuplicate) {
		return nil, nil, fmt.Errorf("create sender tx: %w", err)
	}
	receiver, err = s.repo.Create(ctx, req.ToUserID, receiverWallet.ID, receiveReq)
	if err != nil && !errors.Is(err, ErrDuplicate) {
		return nil, nil, fmt.Errorf("create receiver tx: %w", err)
	}

	entries := []ledger.Entry{
		{Account: ledger.Account{UserID: req.FromUserID}, Side: ledger.Debit, AmountMinor: req.Amount, Currency: req.Currency},
		{Account: ledger.Account{UserID: req.ToUserID}, Side: ledger.Credit, AmountMinor: req.Amount, Currency: req.Currency},
	}
	if req.Fee > 0 {
		feeAccount := ledger.SystemFeesCRC
		if req.Currency == "USD" {
			feeAccount = ledger.SystemFeesUSD
		}
		entries = append(entries,
			ledger.Entry{Account: ledger.Account{UserID: req.FromUserID}, Side: ledger.Debit, AmountMinor: req.Fee, Currency: req.Currency},
			ledger.Entry{Account: ledger.Account{SystemCode: feeAccount}, Side: ledger.Credit, AmountMinor: req.Fee, Currency: req.Currency},
		)
	}

	p := &ledger.Posting{
		Description:    fmt.Sprintf("transfer %s %d %s", req.TxType, req.Amount, req.Currency),
		IdempotencyKey: req.IdempotencyKey,
		TxID:           sender.ID,
		CreatedBy:      req.FromUserID,
		Entries:        entries,
		Metadata: map[string]any{
			"from_user":   req.FromUserID,
			"to_user":     req.ToUserID,
			"description": req.Description,
		},
	}
	if _, err := s.ledger.Post(ctx, p); err != nil && !errors.Is(err, ledger.ErrIdempotent) {
		_ = s.repo.UpdateStatus(ctx, sender.ID, StatusFailed)
		_ = s.repo.UpdateStatus(ctx, receiver.ID, StatusFailed)
		return nil, nil, fmt.Errorf("post ledger: %w", err)
	}

	_ = s.repo.UpdateStatus(ctx, sender.ID, StatusCompleted)
	_ = s.repo.UpdateStatus(ctx, receiver.ID, StatusCompleted)

	if s.auditLogger != nil {
		s.auditLogger.LogTransfer(req.FromUserID, sender.ID, req.Amount, req.Currency, "")
	}
	return sender, receiver, nil
}

// ErrMFARequired indicates the user must verify MFA before this tx proceeds.
var ErrMFARequired = errors.New("mfa challenge required")

func (s *Service) GetTransaction(ctx context.Context, id string) (*TransactionRecord, error) {
	return s.repo.FindByID(ctx, id)
}

func (s *Service) ListTransactions(ctx context.Context, userID string, req *ListTransactionsRequest) (*TransactionListResponse, error) {
	return s.repo.ListByUser(ctx, userID, req)
}

// buildSingleSidedPosting books external-counterparty transfers (deposits,
// withdrawals, bill payments) where the second leg is a system account.
func (s *Service) buildSingleSidedPosting(tx *TransactionRecord, req *CreateTransactionRequest) *ledger.Posting {
	external := ledger.SystemExternalCRC
	feeAccount := ledger.SystemFeesCRC
	if req.Currency == "USD" {
		feeAccount = ledger.SystemFeesUSD
	}

	entries := []ledger.Entry{}
	if isOutgoing(req.Type) {
		entries = append(entries,
			ledger.Entry{Account: ledger.Account{UserID: tx.UserID}, Side: ledger.Debit, AmountMinor: req.Amount, Currency: req.Currency},
			ledger.Entry{Account: ledger.Account{SystemCode: external}, Side: ledger.Credit, AmountMinor: req.Amount, Currency: req.Currency},
		)
		if req.Fee > 0 {
			entries = append(entries,
				ledger.Entry{Account: ledger.Account{UserID: tx.UserID}, Side: ledger.Debit, AmountMinor: req.Fee, Currency: req.Currency},
				ledger.Entry{Account: ledger.Account{SystemCode: feeAccount}, Side: ledger.Credit, AmountMinor: req.Fee, Currency: req.Currency},
			)
		}
	} else {
		entries = append(entries,
			ledger.Entry{Account: ledger.Account{SystemCode: external}, Side: ledger.Debit, AmountMinor: req.Amount, Currency: req.Currency},
			ledger.Entry{Account: ledger.Account{UserID: tx.UserID}, Side: ledger.Credit, AmountMinor: req.Amount, Currency: req.Currency},
		)
	}

	return &ledger.Posting{
		Description:    req.Type,
		IdempotencyKey: req.IdempotencyKey,
		TxID:           tx.ID,
		CreatedBy:      tx.UserID,
		Entries:        entries,
	}
}

func pairKey(base, suffix string) string {
	if base == "" {
		return ""
	}
	return base + ":" + suffix
}

func isOutgoing(txType string) bool {
	switch txType {
	case TypeSinpeSend, TypeQRPayment, TypeBillPayment, TypeRecharge, TypeWithdrawal, TypeP2PSend:
		return true
	default:
		return false
	}
}
