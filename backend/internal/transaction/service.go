package transaction

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
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

// UIFReporter (optional) is notified, best-effort, after an outgoing
// transaction posts, so it can evaluate AML/UIF reporting thresholds. It must
// not block or fail the transaction.
type UIFReporter interface {
	Report(ctx context.Context, userID, txID, currency string, amountMinor int64)
}

type Service struct {
	repo        *Repository
	walletRepo  *wallet.Repository
	ledger      *ledger.Engine
	auditLogger *audit.Logger
	mfa         MFAEnforcer
	uif         UIFReporter
}

// Options carries optional collaborators.
type Options struct {
	AuditLogger *audit.Logger
	MFA         MFAEnforcer
	UIF         UIFReporter
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
		uif:         opts.UIF,
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
		if w.DailyLimit > 0 {
			spentToday, err := s.repo.DailyOutgoingMinor(ctx, userID, req.Currency)
			if err != nil {
				return nil, fmt.Errorf("daily spend check: %w", err)
			}
			if spentToday+req.Amount > w.DailyLimit {
				return nil, fmt.Errorf("daily spending limit exceeded")
			}
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

	if isOutgoing(req.Type) {
		if s.auditLogger != nil {
			s.auditLogger.LogTransfer(userID, tx.ID, req.Amount, req.Currency, "")
		}
		if s.uif != nil {
			s.uif.Report(ctx, userID, tx.ID, req.Currency, req.Amount)
		}
	}
	return tx, nil
}

// CreateTransferRequest carries both legs of an internal transfer.
// MerchantBalance is the shop's own balance in minor units, derived from the
// journal (no cache, so it cannot drift).
func (s *Service) MerchantBalance(ctx context.Context, merchantID, currency string) (int64, error) {
	return s.ledger.MerchantBalance(ctx, merchantID, currency)
}

// WithdrawMerchantToUser moves money from a shop's balance into the owner's
// personal wallet: debit the merchant account, credit the user wallet. The
// engine updates the user's balance cache from the credit leg.
//
// The caller supplies idempotencyKey so a retried or double-tapped withdrawal
// settles once. The replay lookup runs BEFORE any balance read: a retry of a
// withdrawal that already drained the balance must return the original result,
// not "insufficient". The balance pre-check here is a fast-fail courtesy only —
// the race-free enforcement is the ledger's in-tx negativity check.
func (s *Service) WithdrawMerchantToUser(
	ctx context.Context, merchantID, userID, currency string, amount int64, idempotencyKey string,
) (*TransactionRecord, error) {
	if amount <= 0 {
		return nil, fmt.Errorf("amount must be positive")
	}
	w, err := s.walletRepo.FindByUserID(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("wallet not found")
	}
	if idempotencyKey == "" {
		idempotencyKey = "mwithdraw:" + uuid.New().String()
	}
	if existing, _ := s.repo.FindByIdempotencyKey(ctx, userID, idempotencyKey); existing != nil {
		return existing, nil
	}
	bal, err := s.ledger.MerchantBalance(ctx, merchantID, currency)
	if err != nil {
		return nil, fmt.Errorf("read merchant balance: %w", err)
	}
	if bal < amount {
		return nil, ErrInsufficientMerchantBalance
	}

	rec, err := s.repo.Create(ctx, userID, w.ID, &CreateTransactionRequest{
		Type:             TypeMerchantWithdrawal,
		Amount:           amount,
		Currency:         currency,
		CounterpartyType: "merchant",
		CounterpartyName: merchantID,
		Description:      "Retiro del saldo del negocio",
		IdempotencyKey:   idempotencyKey,
	})
	if err != nil {
		if errors.Is(err, ErrDuplicate) {
			// A concurrent retry won the insert; it owns the posting.
			return rec, nil
		}
		return nil, fmt.Errorf("create withdrawal tx: %w", err)
	}

	_, err = s.ledger.Post(ctx, &ledger.Posting{
		Description:    fmt.Sprintf("merchant withdrawal %d %s", amount, currency),
		IdempotencyKey: idempotencyKey,
		TxID:           rec.ID,
		CreatedBy:      userID,
		Entries: []ledger.Entry{
			{Account: ledger.Account{MerchantID: merchantID}, Side: ledger.Debit, AmountMinor: amount, Currency: currency},
			{Account: ledger.Account{UserID: userID}, Side: ledger.Credit, AmountMinor: amount, Currency: currency},
		},
		Metadata: map[string]any{"merchant_id": merchantID, "to_user": userID},
	})
	if err != nil && !errors.Is(err, ledger.ErrIdempotent) {
		_ = s.repo.UpdateStatus(ctx, rec.ID, StatusFailed)
		if errors.Is(err, ledger.ErrInsufficientFunds) {
			return nil, ErrInsufficientMerchantBalance
		}
		return nil, fmt.Errorf("post withdrawal: %w", err)
	}
	if err := s.repo.UpdateStatus(ctx, rec.ID, StatusCompleted); err != nil {
		return nil, fmt.Errorf("mark completed: %w", err)
	}
	return rec, nil
}

type CreateTransferRequest struct {
	FromUserID string
	ToUserID   string
	// ToMerchantID credits a shop's own ledger balance instead of a user wallet
	// (business income is kept apart from the owner's personal money; they
	// withdraw explicitly). Mutually exclusive with ToUserID. When set there is
	// no receiver `transactions` row: the shop's record is the qr_payments row
	// plus the journal entry.
	ToMerchantID   string
	Amount         int64
	Currency       string
	Fee            int64
	Description    string
	IdempotencyKey string
	TxType         string // for the sender's transactions row
	ReceiveType    string // for the receiver's transactions row (e.g. p2p_receive)

	// FeeFromReceiver selects who absorbs Fee. Default (false) is the historical
	// payer-absorbed model: the payer pays Amount + Fee, the receiver is credited
	// the full Amount, and Fee is booked to SYSTEM:FEES. When true (merchant
	// model), the payer pays exactly Amount, the receiver is credited
	// Amount - Fee, and Fee is booked to SYSTEM:FEES. Either way the posting is
	// balanced and Fee always lands in SYSTEM:FEES.
	FeeFromReceiver bool
}

// CreateTransfer atomically debits sender, credits receiver, books fee to
// SYSTEM:FEES, and writes 2 transactions rows (one each). All in one tx.
func (s *Service) CreateTransfer(ctx context.Context, req *CreateTransferRequest) (sender, receiver *TransactionRecord, err error) {
	if req.Amount <= 0 {
		return nil, nil, fmt.Errorf("amount must be positive")
	}
	toMerchant := req.ToMerchantID != ""
	if toMerchant && req.ToUserID != "" {
		return nil, nil, fmt.Errorf("only one of ToUserID/ToMerchantID allowed")
	}
	if !toMerchant && req.ToUserID == "" {
		return nil, nil, fmt.Errorf("receiver required")
	}
	if !toMerchant && req.FromUserID == req.ToUserID {
		return nil, nil, fmt.Errorf("sender and receiver must differ")
	}
	if req.Fee < 0 {
		return nil, nil, fmt.Errorf("fee must not be negative")
	}
	// In the merchant model the fee is carved out of the amount, so it must leave
	// a positive credit for the receiver (the ledger rejects non-positive entries).
	if req.FeeFromReceiver && req.Fee >= req.Amount {
		return nil, nil, fmt.Errorf("fee must be less than amount")
	}
	if req.Currency == "" {
		req.Currency = "CRC"
	}

	// Idempotency: if already done, return BOTH existing rows. The receiver leg
	// was stored under the derived "recv" key, so look it up too — callers that
	// record a follow-on row keyed off the receiver can then detect the replay.
	if req.IdempotencyKey != "" {
		if existing, _ := s.repo.FindByIdempotencyKey(ctx, req.FromUserID, req.IdempotencyKey); existing != nil {
			// A merchant collection has no receiver row to replay.
			var recv *TransactionRecord
			if !toMerchant {
				recv, _ = s.repo.FindByIdempotencyKey(ctx, req.ToUserID, pairKey(req.IdempotencyKey, "recv"))
			}
			return existing, recv, nil
		}
	}

	senderWallet, err := s.walletRepo.FindByUserID(ctx, req.FromUserID)
	if err != nil {
		return nil, nil, fmt.Errorf("sender wallet not found")
	}
	var receiverWallet *wallet.WalletRecord
	if !toMerchant {
		receiverWallet, err = s.walletRepo.FindByUserID(ctx, req.ToUserID)
		if err != nil {
			return nil, nil, fmt.Errorf("receiver wallet not found")
		}
	}

	// The payer only funds the fee when it is payer-absorbed; in the merchant
	// model the fee comes out of the receiver's credit, so the payer needs Amount.
	senderTotal := req.Amount
	if !req.FeeFromReceiver {
		senderTotal += req.Fee
	}
	if req.Currency == "CRC" && senderWallet.BalanceCRC < senderTotal {
		return nil, nil, fmt.Errorf("insufficient balance")
	}
	if req.Currency == "USD" && senderWallet.BalanceUSD < senderTotal {
		return nil, nil, fmt.Errorf("insufficient balance")
	}
	if senderWallet.DailyLimit > 0 {
		spentToday, err := s.repo.DailyOutgoingMinor(ctx, req.FromUserID, req.Currency)
		if err != nil {
			return nil, nil, fmt.Errorf("daily spend check: %w", err)
		}
		if spentToday+req.Amount > senderWallet.DailyLimit {
			return nil, nil, fmt.Errorf("daily spending limit exceeded")
		}
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

	// The fee shows on whichever party absorbs it: the payer's row in the classic
	// model, the receiver's row (a deduction from what they collect) in the
	// merchant model.
	senderFee, receiverFee := req.Fee, int64(0)
	if req.FeeFromReceiver {
		senderFee, receiverFee = 0, req.Fee
	}
	senderReq := &CreateTransactionRequest{
		Type:             req.TxType,
		Amount:           req.Amount,
		Currency:         req.Currency,
		Fee:              senderFee,
		CounterpartyType: "user",
		CounterpartyName: "", // populated by caller (sinpe handler resolves)
		Description:      req.Description,
		IdempotencyKey:   req.IdempotencyKey,
	}
	receiveReq := &CreateTransactionRequest{
		Type:             req.ReceiveType,
		Amount:           req.Amount,
		Currency:         req.Currency,
		Fee:              receiverFee,
		CounterpartyType: "user",
		Description:      req.Description,
		// Receiver idempotency: derive deterministically to avoid double-credit.
		IdempotencyKey: pairKey(req.IdempotencyKey, "recv"),
	}

	sender, err = s.repo.Create(ctx, req.FromUserID, senderWallet.ID, senderReq)
	if err != nil && !errors.Is(err, ErrDuplicate) {
		return nil, nil, fmt.Errorf("create sender tx: %w", err)
	}
	// A shop is not a user: its side of the collection is the qr_payments row
	// plus the journal entry, so there is no receiver `transactions` row.
	if !toMerchant {
		receiver, err = s.repo.Create(ctx, req.ToUserID, receiverWallet.ID, receiveReq)
		if err != nil && !errors.Is(err, ErrDuplicate) {
			return nil, nil, fmt.Errorf("create receiver tx: %w", err)
		}
	}

	// Build the balanced posting. Two fee models, both booking Fee to SYSTEM:FEES:
	//   payer-absorbed (default): payer -Amount-Fee, receiver +Amount, fees +Fee.
	//   merchant-absorbed (FeeFromReceiver): payer -Amount, receiver +Amount-Fee, fees +Fee.
	feeAccount := ledger.SystemFeesCRC
	if req.Currency == "USD" {
		feeAccount = ledger.SystemFeesUSD
	}
	// The credit leg lands either in a user wallet or in the shop's own account.
	creditAccount := ledger.Account{UserID: req.ToUserID}
	if toMerchant {
		creditAccount = ledger.Account{MerchantID: req.ToMerchantID}
	}
	var entries []ledger.Entry
	if req.Fee > 0 && req.FeeFromReceiver {
		entries = []ledger.Entry{
			{Account: ledger.Account{UserID: req.FromUserID}, Side: ledger.Debit, AmountMinor: req.Amount, Currency: req.Currency},
			{Account: creditAccount, Side: ledger.Credit, AmountMinor: req.Amount - req.Fee, Currency: req.Currency},
			{Account: ledger.Account{SystemCode: feeAccount}, Side: ledger.Credit, AmountMinor: req.Fee, Currency: req.Currency},
		}
	} else {
		entries = []ledger.Entry{
			{Account: ledger.Account{UserID: req.FromUserID}, Side: ledger.Debit, AmountMinor: req.Amount, Currency: req.Currency},
			{Account: creditAccount, Side: ledger.Credit, AmountMinor: req.Amount, Currency: req.Currency},
		}
		if req.Fee > 0 {
			entries = append(entries,
				ledger.Entry{Account: ledger.Account{UserID: req.FromUserID}, Side: ledger.Debit, AmountMinor: req.Fee, Currency: req.Currency},
				ledger.Entry{Account: ledger.Account{SystemCode: feeAccount}, Side: ledger.Credit, AmountMinor: req.Fee, Currency: req.Currency},
			)
		}
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
			"to_merchant": req.ToMerchantID,
			"description": req.Description,
		},
	}
	// A merchant collection has no receiver row (`receiver` is nil): the shop's
	// record is qr_payments + the journal entry.
	if _, err := s.ledger.Post(ctx, p); err != nil && !errors.Is(err, ledger.ErrIdempotent) {
		_ = s.repo.UpdateStatus(ctx, sender.ID, StatusFailed)
		if receiver != nil {
			_ = s.repo.UpdateStatus(ctx, receiver.ID, StatusFailed)
		}
		return nil, nil, fmt.Errorf("post ledger: %w", err)
	}

	_ = s.repo.UpdateStatus(ctx, sender.ID, StatusCompleted)
	if receiver != nil {
		_ = s.repo.UpdateStatus(ctx, receiver.ID, StatusCompleted)
	}

	if s.auditLogger != nil {
		s.auditLogger.LogTransfer(req.FromUserID, sender.ID, req.Amount, req.Currency, "")
	}
	if s.uif != nil {
		s.uif.Report(ctx, req.FromUserID, sender.ID, req.Currency, req.Amount)
	}
	return sender, receiver, nil
}

// ErrMFARequired indicates the user must verify MFA before this tx proceeds.
var ErrMFARequired = errors.New("mfa challenge required")

// ErrInsufficientMerchantBalance rejects a withdrawal larger than the shop's
// journal-derived balance. The exact string reaches the client as the 400
// message, so keep it stable.
var ErrInsufficientMerchantBalance = errors.New("insufficient business balance")

// RecordHistory inserts a COMPLETED history row for a movement whose money
// already moved through the ledger elsewhere (e.g. escrow fund/release/refund
// post directly against SYSTEM:ESCROW). It performs no balance checks and no
// posting — it only makes the movement visible in the user's transaction
// list. Idempotent via the request's IdempotencyKey (duplicates are ignored).
func (s *Service) RecordHistory(ctx context.Context, userID string, req *CreateTransactionRequest) error {
	w, err := s.walletRepo.FindByUserID(ctx, userID)
	if err != nil {
		return fmt.Errorf("find wallet: %w", err)
	}
	tx, err := s.repo.Create(ctx, userID, w.ID, req)
	if err != nil {
		if errors.Is(err, ErrDuplicate) {
			return nil
		}
		return fmt.Errorf("record history: %w", err)
	}
	return s.repo.UpdateStatus(ctx, tx.ID, StatusCompleted)
}

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
	case TypeSinpeSend, TypeQRPayment, TypeBillPayment, TypeRecharge, TypeWithdrawal, TypeP2PSend, TypeCryptoBuy:
		return true
	default:
		return false
	}
}
