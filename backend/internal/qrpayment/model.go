package qrpayment

import "time"

// ── Merchant QR ──────────────────────────────────────────────────────────────

type Merchant struct {
	ID          string `json:"id"`
	UserID      string `json:"user_id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Category    string `json:"category"` // restaurant, retail, services, food_truck, market
	LogoURL     string `json:"logo_url"`
	QRCode      string `json:"qr_code"` // unique QR identifier
	Active      bool   `json:"active"`

	// Light KYC + admin verification. A merchant starts "pending"; an admin moves
	// it to "verified" (can collect with merchant QR codes) or "rejected".
	Cedula             string     `json:"cedula"`
	CedulaType         string     `json:"cedula_type"` // fisica, juridica
	LegalName          string     `json:"legal_name"`
	VerificationStatus string     `json:"verification_status"` // pending, verified, rejected
	RejectionReason    string     `json:"rejection_reason,omitempty"`
	ReviewedAt         *time.Time `json:"reviewed_at,omitempty"`

	// CommissionBps is the merchant-absorbed commission in basis points
	// (50 = 0.50%). Charged on each merchant QR payment in ScanAndPay.
	CommissionBps int       `json:"commission_bps"`
	CreatedAt     time.Time `json:"created_at"`
}

// ── QR Payment Code ──────────────────────────────────────────────────────────

type QRPaymentCode struct {
	ID         string     `json:"id"`
	CreatorID  string     `json:"creator_id"`
	Type       string     `json:"type"` // merchant_fixed, merchant_dynamic, p2p_request, p2p_receive
	Amount     int64      `json:"amount,omitempty"` // centimos, 0 = payer enters amount
	Currency   string     `json:"currency"`
	MerchantID string     `json:"merchant_id,omitempty"`
	Note       string     `json:"note,omitempty"`
	QRData     string     `json:"qr_data"` // encoded payload
	SingleUse  bool       `json:"single_use"`
	Used       bool       `json:"used"`
	ExpiresAt  *time.Time `json:"expires_at,omitempty"`
	CreatedAt  time.Time  `json:"created_at"`
}

// ── QR Payment Transaction ───────────────────────────────────────────────────

type QRPaymentRecord struct {
	ID          string     `json:"id"`
	QRCodeID    string     `json:"qr_code_id"`
	PayerID     string     `json:"payer_id"`
	ReceiverID  string     `json:"receiver_id"`
	MerchantID  string     `json:"merchant_id,omitempty"`
	Amount      int64      `json:"amount"`         // centimos, gross paid by payer
	Fee         int64      `json:"fee"`            // centimos, merchant commission (0 for P2P)
	Currency    string     `json:"currency"`
	Status      string     `json:"status"` // pending, completed, failed, refunded
	Note        string     `json:"note,omitempty"`
	TxID        string     `json:"tx_id,omitempty"` // linked transaction ID
	CreatedAt   time.Time  `json:"created_at"`
	CompletedAt *time.Time `json:"completed_at,omitempty"`
}

// ── Request DTOs ─────────────────────────────────────────────────────────────

type RegisterMerchantRequest struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Category    string `json:"category"`
	Cedula      string `json:"cedula"`
	CedulaType  string `json:"cedula_type"` // fisica, juridica
	LegalName   string `json:"legal_name"`
}

type CreateQRCodeRequest struct {
	Type       string `json:"type"`             // merchant_fixed, merchant_dynamic, p2p_request, p2p_receive
	Amount     int64  `json:"amount,omitempty"` // centimos
	Currency   string `json:"currency"`
	Note       string `json:"note,omitempty"`
	SingleUse  bool   `json:"single_use"`
	MerchantID string `json:"merchant_id,omitempty"` // required for merchant_* types
}

// VerificationDecisionRequest is the admin reject payload (reason is ignored on
// approve).
type VerificationDecisionRequest struct {
	Reason string `json:"reason,omitempty"`
}

type ScanQRPaymentRequest struct {
	QRData   string `json:"qr_data"`
	Amount   int64  `json:"amount,omitempty"` // centimos, required if QR has no fixed amount
	Currency string `json:"currency"`
}
