package qrpayment

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"time"

	"github.com/google/uuid"
)

type Service struct {
	repo *Repository
}

func NewService(repo *Repository) *Service {
	return &Service{repo: repo}
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

	currency := qr.Currency
	if req.Currency != "" {
		currency = req.Currency
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
		CreatedAt:  time.Now(),
	}

	if err := s.repo.CreatePayment(ctx, payment); err != nil {
		return nil, err
	}

	// Mark single-use QR as used
	if qr.SingleUse {
		s.repo.MarkQRUsed(ctx, qr.ID)
	}

	return payment, nil
}

func (s *Service) GetPaymentHistory(ctx context.Context, userID string) ([]QRPaymentRecord, error) {
	return s.repo.GetUserPayments(ctx, userID, 50)
}

// ── Helpers ──────────────────────────────────────────────────────────────────

func generateQRIdentifier() string {
	b := make([]byte, 8)
	rand.Read(b)
	return "MRC-" + hex.EncodeToString(b)
}

func generateQRToken() string {
	b := make([]byte, 12)
	rand.Read(b)
	return hex.EncodeToString(b)
}
