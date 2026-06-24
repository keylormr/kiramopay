package sinpe

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/kiramopay/backend/internal/audit"
	"github.com/kiramopay/backend/internal/transaction"
	"github.com/kiramopay/backend/internal/user"
	"github.com/kiramopay/backend/internal/wallet"
)

// Notifier delivers a user-facing notification (history + push). Implemented by
// the notification service; optional so sinpe works without it.
type Notifier interface {
	NotifyUser(ctx context.Context, userID, title, body, tag string) error
}

type Service struct {
	repo        *Repository
	txService   *transaction.Service
	walletRepo  *wallet.Repository
	userRepo    *user.Repository
	auditLogger *audit.Logger
	notifier    Notifier
}

// Options bundles optional collaborators.
type Options struct {
	AuditLogger *audit.Logger
	Notifier    Notifier
}

func NewService(
	repo *Repository,
	txService *transaction.Service,
	walletRepo *wallet.Repository,
	userRepo *user.Repository,
	opts *Options,
) *Service {
	if opts == nil {
		opts = &Options{}
	}
	return &Service{
		repo:        repo,
		txService:   txService,
		walletRepo:  walletRepo,
		userRepo:    userRepo,
		auditLogger: opts.AuditLogger,
		notifier:    opts.Notifier,
	}
}

func (s *Service) GetContacts(ctx context.Context, userID string) ([]ContactRecord, error) {
	return s.repo.GetContacts(ctx, userID)
}

func (s *Service) AddContact(ctx context.Context, userID, phone, name, bank string) (*ContactRecord, error) {
	return s.repo.AddContact(ctx, userID, phone, name, bank)
}

func (s *Service) GetHistory(ctx context.Context, userID string) ([]HistoryRecord, error) {
	return s.repo.GetHistory(ctx, userID, 50)
}

// notifyReceiver delivers the "SINPE received" notification on a context
// detached from the (already-completed) request, bounded by its own timeout.
// Best-effort: never blocks or fails the transfer.
func (s *Service) notifyReceiver(userID, body string) {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	_ = s.notifier.NotifyUser(ctx, userID, "SINPE recibido", body, "transaction")
}

// Send transfers CRC to a recipient phone. If the phone belongs to a
// KiramoPay user, the transfer is INTERNAL: both legs are booked atomically
// against the ledger and the receiver's wallet is credited. If the phone is
// external, the transfer is booked against the SYSTEM:EXTERNAL account.
func (s *Service) Send(ctx context.Context, userID string, req *SendRequest, ipAddr string) (*SendResponse, error) {
	if req.Amount <= 0 {
		return nil, fmt.Errorf("amount must be positive")
	}
	if req.Amount > MaxSinglePaymentCRC {
		return nil, fmt.Errorf("amount exceeds single-payment ceiling")
	}
	if !validCRMobile(req.Phone) {
		return nil, fmt.Errorf("invalid SINPE Móvil phone number")
	}

	// Serialize concurrent SINPE sends for THIS user so the daily-limit check
	// below and the debit further down cannot interleave (two parallel sends
	// each reading a stale "spent" total and both passing the 500K ceiling).
	unlock, err := s.repo.AcquireUserSendLock(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("serialize send: %w", err)
	}
	defer unlock()

	// Daily SINPE quota check — now race-free under the per-user lock.
	dailySpent, err := s.repo.GetDailySinpeSpent(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("check daily limit: %w", err)
	}
	if dailySpent+req.Amount > DailyLimitCRC {
		return nil, fmt.Errorf("SINPE daily limit exceeded")
	}

	// Resolve recipient — internal vs external.
	peer, _ := s.userRepo.FindByPhone(ctx, req.Phone)
	internal := peer != nil && peer.ID != userID

	contactName := req.Phone
	contact, _ := s.repo.FindContactByPhone(ctx, userID, req.Phone)
	if contact != nil {
		contactName = contact.Name
	} else if peer != nil {
		contactName = peer.FirstName + " " + peer.LastName
	}

	// Internal transfers have no fee; cross-bank charges a flat fee.
	fee := int64(TransactionFee)
	if internal {
		fee = 0
	}

	w, err := s.walletRepo.FindByUserID(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("wallet not found")
	}
	if w.BalanceCRC < req.Amount+fee {
		return nil, fmt.Errorf("insufficient balance")
	}

	idem := req.IdempotencyKey
	if idem == "" {
		idem = "sinpe:" + uuid.New().String()
	}

	var (
		senderTx   *transaction.TransactionRecord
		receiverTx *transaction.TransactionRecord
	)
	if internal {
		senderTx, receiverTx, err = s.txService.CreateTransfer(ctx, &transaction.CreateTransferRequest{
			FromUserID:     userID,
			ToUserID:       peer.ID,
			Amount:         req.Amount,
			Currency:       "CRC",
			Fee:            fee,
			Description:    req.Description,
			IdempotencyKey: idem,
			TxType:         transaction.TypeSinpeSend,
			ReceiveType:    transaction.TypeSinpeReceive,
		})
	} else {
		senderTx, err = s.txService.CreateTransaction(ctx, userID, &transaction.CreateTransactionRequest{
			Type:              transaction.TypeSinpeSend,
			Amount:            req.Amount,
			Currency:          "CRC",
			Fee:               fee,
			CounterpartyType:  "bank",
			CounterpartyName:  contactName,
			CounterpartyPhone: req.Phone,
			Description:       req.Description,
			IdempotencyKey:    idem,
		})
	}
	if err != nil {
		if errors.Is(err, transaction.ErrMFARequired) {
			return nil, err
		}
		return nil, fmt.Errorf("create transaction: %w", err)
	}

	// Sender side of sinpe_history. This row feeds GetDailySinpeSpent, so a
	// silent failure would let the user undercount toward the daily ceiling —
	// surface it as a high-risk audit event instead of swallowing it.
	if err := s.repo.AddHistory(ctx, &HistoryRecord{
		ID:          uuid.New().String(),
		UserID:      userID,
		Phone:       req.Phone,
		ContactName: contactName,
		Amount:      req.Amount,
		Fee:         fee,
		Type:        "sent",
		Status:      "completed",
		Description: req.Description,
		CreatedAt:   time.Now(),
	}); err != nil && s.auditLogger != nil {
		s.auditLogger.Log(audit.Event{
			UserID:    userID,
			Action:    "sinpe_history_write_failed",
			RiskLevel: "high",
			IPAddress: ipAddr,
		})
	}
	// Receiver side (only when internal — for external transfers the bank
	// keeps the receive record).
	if internal && receiverTx != nil {
		_ = s.repo.AddHistory(ctx, &HistoryRecord{
			ID:          uuid.New().String(),
			UserID:      peer.ID,
			Phone:       w.UserID, // sender id stand-in; real impl would use sender phone
			ContactName: "KiramoPay user",
			Amount:      req.Amount,
			Fee:         0,
			Type:        "received",
			Status:      "completed",
			Description: req.Description,
			CreatedAt:   time.Now(),
		})
		// Notify the recipient (best-effort, detached so it never blocks or
		// fails the transfer). This is the first real notification trigger.
		if s.notifier != nil {
			body := fmt.Sprintf("Recibiste ₡%d.%02d por SINPE Móvil", req.Amount/100, req.Amount%100)
			// #nosec G118 -- intentionally detached: the request context is
			// cancelled when the response returns, but this best-effort
			// notification must outlive the request (notifyReceiver uses its own
			// bounded context).
			go s.notifyReceiver(peer.ID, body)
		}
	}

	if s.auditLogger != nil {
		s.auditLogger.LogTransfer(userID, senderTx.ID, req.Amount, "CRC", ipAddr)
	}
	return &SendResponse{
		TransactionID: senderTx.ID,
		Status:        "completed",
		Amount:        req.Amount,
		Fee:           fee,
		Recipient:     contactName,
	}, nil
}

// validCRMobile reports whether p is a valid Costa Rican mobile number for
// SINPE Móvil: 8 digits starting with 6, 7 or 8, with an optional +506 / 506
// country-code prefix.
func validCRMobile(p string) bool {
	d := digitsOnly(p)
	d = strings.TrimPrefix(d, "506")
	if len(d) != 8 {
		return false
	}
	switch d[0] {
	case '6', '7', '8':
		return true
	default:
		return false
	}
}

func digitsOnly(s string) string {
	var b strings.Builder
	for _, r := range s {
		if r >= '0' && r <= '9' {
			b.WriteByte(byte(r))
		}
	}
	return b.String()
}
