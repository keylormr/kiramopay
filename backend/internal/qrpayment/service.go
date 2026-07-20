package qrpayment

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/kiramopay/backend/internal/transaction"
)

type Service struct {
	repo *Repository
	tx   *transaction.Service
}

func NewService(repo *Repository, tx *transaction.Service) *Service {
	return &Service{repo: repo, tx: tx}
}

// defaultCommissionBps is the merchant commission applied to new merchants
// (50 basis points = 0.50%), mirroring the DB column default.
const defaultCommissionBps = 50

// ── Merchants ────────────────────────────────────────────────────────────────

func (s *Service) RegisterMerchant(ctx context.Context, userID string, req *RegisterMerchantRequest) (*Merchant, error) {
	if req.Name == "" {
		return nil, fmt.Errorf("merchant name is required")
	}
	if req.Cedula == "" {
		return nil, fmt.Errorf("cedula is required")
	}
	if req.LegalName == "" {
		return nil, fmt.Errorf("legal name is required")
	}
	cedulaType := req.CedulaType
	if cedulaType == "" {
		cedulaType = "fisica"
	}
	if cedulaType != "fisica" && cedulaType != "juridica" {
		return nil, fmt.Errorf("invalid cedula type")
	}

	// A user may run several businesses, so there is no "already registered"
	// guard. The merchant starts pending until an admin verifies it.
	merchant := &Merchant{
		ID:                 uuid.New().String(),
		UserID:             userID,
		Name:               req.Name,
		Description:        req.Description,
		Category:           req.Category,
		QRCode:             generateQRIdentifier(),
		Active:             true,
		Cedula:             req.Cedula,
		CedulaType:         cedulaType,
		LegalName:          req.LegalName,
		VerificationStatus: "pending",
		CommissionBps:      defaultCommissionBps,
		CreatedAt:          time.Now(),
	}

	if err := s.repo.CreateMerchant(ctx, merchant); err != nil {
		return nil, err
	}

	return merchant, nil
}

// GetMerchants returns every merchant profile the user owns.
func (s *Service) GetMerchants(ctx context.Context, userID string) ([]Merchant, error) {
	return s.repo.GetMerchantsByUserID(ctx, userID)
}

// ── QR Codes ─────────────────────────────────────────────────────────────────

func (s *Service) CreateQRCode(ctx context.Context, userID string, req *CreateQRCodeRequest) (*QRPaymentCode, error) {
	validTypes := map[string]bool{
		"merchant_fixed": true, "merchant_dynamic": true,
		"p2p_request": true, "p2p_receive": true,
	}
	if !validTypes[req.Type] {
		return nil, fmt.Errorf("invalid QR type: %s", req.Type)
	}

	if req.Currency == "" {
		req.Currency = "CRC"
	}

	var merchantID string
	if req.Type == "merchant_fixed" || req.Type == "merchant_dynamic" {
		if req.MerchantID == "" {
			return nil, fmt.Errorf("merchant_id is required for merchant QR codes")
		}
		merchant, err := s.repo.GetMerchant(ctx, req.MerchantID)
		if err != nil {
			return nil, fmt.Errorf("merchant profile not found")
		}
		if merchant.UserID != userID {
			return nil, fmt.Errorf("merchant does not belong to user")
		}
		if merchant.VerificationStatus != "verified" {
			return nil, fmt.Errorf("merchant is pending verification")
		}
		merchantID = merchant.ID
	}

	// QR data encodes: type|creatorID|amount|currency|uniqueToken
	qrData := fmt.Sprintf("KP:%s:%s:%d:%s:%s", req.Type, userID[:8], req.Amount, req.Currency, generateQRToken())

	// Single-use P2P requests expire in 24h, merchant codes don't expire
	var expiresAt *time.Time
	if req.SingleUse {
		t := time.Now().Add(24 * time.Hour)
		expiresAt = &t
	}

	qr := &QRPaymentCode{
		ID:         uuid.New().String(),
		CreatorID:  userID,
		Type:       req.Type,
		Amount:     req.Amount,
		Currency:   req.Currency,
		MerchantID: merchantID,
		Note:       req.Note,
		QRData:     qrData,
		SingleUse:  req.SingleUse,
		ExpiresAt:  expiresAt,
		CreatedAt:  time.Now(),
	}

	if err := s.repo.CreateQRCode(ctx, qr); err != nil {
		return nil, err
	}

	return qr, nil
}

func (s *Service) GetUserQRCodes(ctx context.Context, userID string) ([]QRPaymentCode, error) {
	return s.repo.GetUserQRCodes(ctx, userID)
}

// ── Scan & Pay ───────────────────────────────────────────────────────────────

func (s *Service) ScanAndPay(ctx context.Context, payerID string, req *ScanQRPaymentRequest) (*QRPaymentRecord, error) {
	qr, err := s.repo.GetQRCodeByData(ctx, req.QRData)
	if err != nil {
		return nil, fmt.Errorf("invalid QR code")
	}

	if qr.Used && qr.SingleUse {
		return nil, fmt.Errorf("QR code has already been used")
	}

	if qr.ExpiresAt != nil && time.Now().After(*qr.ExpiresAt) {
		return nil, fmt.Errorf("QR code has expired")
	}

	if qr.CreatorID == payerID {
		return nil, fmt.Errorf("cannot pay your own QR code")
	}

	// Determine payment amount
	amount := qr.Amount
	if amount == 0 {
		amount = req.Amount
		if amount <= 0 {
			return nil, fmt.Errorf("amount is required for this QR code")
		}
	}

	// The currency is defined by the QR creator and must NOT be overridable by
	// the payer (that would let a payer settle a USD invoice in CRC).
	currency := qr.Currency

	// Merchant commission (absorbed by the merchant): when the QR belongs to a
	// merchant, carve commission_bps of the amount and route it to SYSTEM:FEES.
	// The payer still pays exactly `amount`; the merchant is credited amount-fee.
	// P2P codes carry no merchant, so they stay 1:1.
	var fee int64
	feeFromReceiver := false
	if qr.MerchantID != "" {
		merchant, err := s.repo.GetMerchant(ctx, qr.MerchantID)
		if err != nil {
			return nil, fmt.Errorf("merchant not found")
		}
		if merchant.VerificationStatus != "verified" {
			return nil, fmt.Errorf("merchant is not available")
		}
		fee = commissionFee(amount, merchant.CommissionBps)
		feeFromReceiver = fee > 0
	}

	// Move the money THROUGH THE LEDGER: debit the payer, credit the QR creator
	// atomically. Idempotency keyed by (qr, payer) prevents a double charge on
	// a retried scan.
	// A merchant QR credits the SHOP's own balance; a personal QR still credits
	// the creator's wallet. Either way the payer side is identical.
	toUserID, toMerchantID := qr.CreatorID, ""
	if qr.MerchantID != "" {
		toUserID, toMerchantID = "", qr.MerchantID
	}

	idem := fmt.Sprintf("qr:%s:%s", qr.ID, payerID)
	sender, _, err := s.tx.CreateTransfer(ctx, &transaction.CreateTransferRequest{
		FromUserID:      payerID,
		ToUserID:        toUserID,
		ToMerchantID:    toMerchantID,
		Amount:          amount,
		Currency:        currency,
		Fee:             fee,
		FeeFromReceiver: feeFromReceiver,
		Description:     qr.Note,
		IdempotencyKey:  idem,
		TxType:          transaction.TypeQRPayment,
		ReceiveType:     transaction.TypeQRReceive,
	})
	if err != nil {
		return nil, fmt.Errorf("qr payment transfer: %w", err)
	}

	// Idempotent on the history row too: the transfer above is idempotent, so a
	// retried scan returns the same sender tx. Guard on its ID to avoid inserting
	// a duplicate qr_payments row.
	if existing, _ := s.repo.GetPaymentByTxID(ctx, sender.ID); existing != nil {
		return existing, nil
	}

	payment := &QRPaymentRecord{
		ID:         uuid.New().String(),
		QRCodeID:   qr.ID,
		PayerID:    payerID,
		ReceiverID: qr.CreatorID,
		MerchantID: qr.MerchantID,
		Amount:     amount,
		Fee:        fee,
		Currency:   currency,
		Status:     "completed",
		Note:       qr.Note,
		TxID:       sender.ID,
		CreatedAt:  time.Now(),
	}

	if err := s.repo.CreatePayment(ctx, payment); err != nil {
		return nil, err
	}

	// Mark single-use QR as used
	if qr.SingleUse {
		_ = s.repo.MarkQRUsed(ctx, qr.ID) // best-effort; double-spend guarded by ledger
	}

	return payment, nil
}

func (s *Service) GetPaymentHistory(ctx context.Context, userID string) ([]QRPaymentRecord, error) {
	return s.repo.GetUserPayments(ctx, userID, 50)
}

// UpdateMerchant lets the OWNER correct their shop's details — the piece the
// rejection flow was missing ("fix it and resubmit" was impossible before).
//
// Identity is not silently editable: if the cedula or legal name changes, the
// merchant goes back to `pending` even if it was already verified, so a shop
// can't swap the legal entity behind a verified badge. A rejected merchant
// returns to `pending` on any edit — that IS the resubmission.
func (s *Service) UpdateMerchant(ctx context.Context, merchantID, userID string, req *RegisterMerchantRequest) (*Merchant, error) {
	current, err := s.repo.GetMerchant(ctx, merchantID)
	if err != nil {
		return nil, fmt.Errorf("merchant not found")
	}
	if current.UserID != userID {
		return nil, fmt.Errorf("merchant not found")
	}
	if req.Name == "" {
		return nil, fmt.Errorf("merchant name is required")
	}
	if req.Cedula == "" {
		return nil, fmt.Errorf("cedula is required")
	}
	if req.LegalName == "" {
		return nil, fmt.Errorf("legal name is required")
	}
	cedulaType := req.CedulaType
	if cedulaType == "" {
		cedulaType = current.CedulaType
	}

	status := current.VerificationStatus
	identityChanged := req.Cedula != current.Cedula || req.LegalName != current.LegalName
	if identityChanged || status == "rejected" {
		status = "pending"
	}

	return s.repo.UpdateMerchantProfile(
		ctx, merchantID, req.Name, req.Description, req.Category,
		req.Cedula, cedulaType, req.LegalName, status,
	)
}

// MerchantBalance returns the shop's own balance (minor units), derived from
// the journal. Owner-only.
func (s *Service) MerchantBalance(ctx context.Context, merchantID, userID, currency string) (int64, error) {
	m, err := s.repo.GetMerchant(ctx, merchantID)
	if err != nil || m.UserID != userID {
		return 0, fmt.Errorf("merchant not found")
	}
	return s.tx.MerchantBalance(ctx, merchantID, currency)
}

// WithdrawToOwner moves money from the shop's balance to the owner's personal
// wallet. This is the only way business income becomes personal money, which is
// the whole point of keeping the two apart.
func (s *Service) WithdrawToOwner(
	ctx context.Context, merchantID, userID, currency string, amount int64, idempotencyKey string,
) error {
	if amount <= 0 {
		return fmt.Errorf("amount must be positive")
	}
	if currency == "" {
		currency = "CRC"
	}
	m, err := s.repo.GetMerchant(ctx, merchantID)
	if err != nil || m.UserID != userID {
		return fmt.Errorf("merchant not found")
	}
	// No balance pre-check here: the transaction service replays idempotent
	// retries first, and the ledger enforces the funds atomically — a read
	// here would just reintroduce the check-then-post race.
	_, err = s.tx.WithdrawMerchantToUser(ctx, merchantID, userID, currency, amount, idempotencyKey)
	return err
}

// ── Admin verification ───────────────────────────────────────────────────────

func (s *Service) ListPendingMerchants(ctx context.Context) ([]Merchant, error) {
	return s.repo.ListPendingMerchants(ctx)
}

func (s *Service) ApproveMerchant(ctx context.Context, merchantID, adminID string) (*Merchant, error) {
	return s.repo.UpdateVerification(ctx, merchantID, "verified", adminID, "")
}

func (s *Service) RejectMerchant(ctx context.Context, merchantID, adminID, reason string) (*Merchant, error) {
	return s.repo.UpdateVerification(ctx, merchantID, "rejected", adminID, reason)
}

// SetCommission updates a merchant's commission rate (basis points). The platform
// sets the rate, so this is an admin action.
func (s *Service) SetCommission(ctx context.Context, merchantID string, bps int) (*Merchant, error) {
	if bps < 0 || bps > 10000 {
		return nil, fmt.Errorf("commission must be between 0 and 10000 bps")
	}
	return s.repo.UpdateCommission(ctx, merchantID, bps)
}

// ── Helpers ──────────────────────────────────────────────────────────────────

// commissionFee returns the merchant commission in centimos for a gross amount,
// floored to the centimo so the ledger math stays exact (no floats). bps is
// basis points: 50 = 0.50%.
func commissionFee(amount int64, bps int) int64 {
	if amount <= 0 || bps <= 0 {
		return 0
	}
	return amount * int64(bps) / 10000
}

func generateQRIdentifier() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b) // crypto/rand.Read does not fail in practice
	return "MRC-" + hex.EncodeToString(b)
}

func generateQRToken() string {
	b := make([]byte, 12)
	_, _ = rand.Read(b) // crypto/rand.Read does not fail in practice
	return hex.EncodeToString(b)
}
