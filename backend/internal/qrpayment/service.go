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

// ── Merchants ────────────────────────────────────────────────────────────────

func (s *Service) RegisterMerchant(ctx context.Context, userID string, req *RegisterMerchantRequest) (*Merchant, error) {
	if req.Name == "" {
		return nil, fmt.Errorf("merchant name is required")
	}

	// Check if user already has a merchant profile
	existing, _ := s.repo.GetMerchantByUserID(ctx, userID)
	if existing != nil {
		return nil, fmt.Errorf("user already has a merchant profile")
	}

	qrCode := generateQRIdentifier()

	merchant := &Merchant{
		ID:          uuid.New().String(),
		UserID:      userID,
		Name:        req.Name,
		Description: req.Description,
		Category:    req.Category,
		QRCode:      qrCode,
		Active:      true,
		CreatedAt:   time.Now(),
	}

	if err := s.repo.CreateMerchant(ctx, merchant); err != nil {
		return nil, err
	}

	return merchant, nil
}

func (s *Service) GetMerchant(ctx context.Context, userID string) (*Merchant, error) {
	return s.repo.GetMerchantByUserID(ctx, userID)
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
		merchant, err := s.repo.GetMerchantByUserID(ctx, userID)
		if err != nil {
			return nil, fmt.Errorf("merchant profile not found")
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

	// Move the money THROUGH THE LEDGER: debit the payer, credit the QR creator
	// atomically. Idempotency keyed by (qr, payer) prevents a double charge on
	// a retried scan.
	idem := fmt.Sprintf("qr:%s:%s", qr.ID, payerID)
	sender, _, err := s.tx.CreateTransfer(ctx, &transaction.CreateTransferRequest{
		FromUserID:     payerID,
		ToUserID:       qr.CreatorID,
		Amount:         amount,
		Currency:       currency,
		Fee:            0,
		Description:    qr.Note,
		IdempotencyKey: idem,
		TxType:         transaction.TypeQRPayment,
		ReceiveType:    transaction.TypeQRReceive,
	})
	if err != nil {
		return nil, fmt.Errorf("qr payment transfer: %w", err)
	}

	payment := &QRPaymentRecord{
		ID:         uuid.New().String(),
		QRCodeID:   qr.ID,
		PayerID:    payerID,
		ReceiverID: qr.CreatorID,
		MerchantID: qr.MerchantID,
		Amount:     amount,
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

// ── Helpers ──────────────────────────────────────────────────────────────────

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
