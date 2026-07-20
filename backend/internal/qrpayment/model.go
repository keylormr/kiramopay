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

	// Role is how the REQUESTING user relates to this merchant (owner, manager
	// or cashier). Filled per-caller by the service, never persisted.
	Role string `json:"role,omitempty"`
}

// ── QR Payment Code ──────────────────────────────────────────────────────────

type QRPaymentCode struct {
	ID         string     `json:"id"`
	CreatorID  string     `json:"creator_id"`
	Type       string     `json:"type"`             // merchant_fixed, merchant_dynamic, p2p_request, p2p_receive
	Amount     int64      `json:"amount,omitempty"` // centimos, 0 = payer enters amount
	Currency   string     `json:"currency"`
	MerchantID string     `json:"merchant_id,omitempty"`
	LocationID string     `json:"location_id,omitempty"` // which shop location charges with it
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
	LocationID  string     `json:"location_id,omitempty"`  // shop location the QR charged for
	CollectedBy string     `json:"collected_by,omitempty"` // owner/staff user who generated the charge
	Amount      int64      `json:"amount"`                 // centimos, gross paid by payer
	Fee         int64      `json:"fee"`                    // centimos, merchant commission (0 for P2P)
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
	LocationID string `json:"location_id,omitempty"` // optional shop location for merchant_* types
}

// ── Team: staff, locations, catalog (phase 3) ────────────────────────────────

// Roles a user can hold on a merchant. Owner is implicit (qr_merchants.user_id
// — never a merchant_staff row); staff rows are cashier or manager.
const (
	RoleOwner   = "owner"
	RoleManager = "manager"
	RoleCashier = "cashier"
)

type StaffMember struct {
	ID         string     `json:"id"`
	MerchantID string     `json:"merchant_id"`
	UserID     string     `json:"user_id"`
	FirstName  string     `json:"first_name"`
	LastName   string     `json:"last_name"`
	Role       string     `json:"role"`   // cashier, manager
	Status     string     `json:"status"` // active, revoked
	LocationID string     `json:"location_id,omitempty"`
	CreatedAt  time.Time  `json:"created_at"`
	RevokedAt  *time.Time `json:"revoked_at,omitempty"`
}

type Location struct {
	ID         string    `json:"id"`
	MerchantID string    `json:"merchant_id"`
	Name       string    `json:"name"`
	Address    string    `json:"address"`
	Active     bool      `json:"active"`
	CreatedAt  time.Time `json:"created_at"`
}

type CatalogItem struct {
	ID         string    `json:"id"`
	MerchantID string    `json:"merchant_id"`
	Name       string    `json:"name"`
	PriceMinor int64     `json:"price_minor"` // centimos
	Currency   string    `json:"currency"`
	Active     bool      `json:"active"`
	SortOrder  int       `json:"sort_order"`
	CreatedAt  time.Time `json:"created_at"`
}

// ── Reports (phase 4) ────────────────────────────────────────────────────────

// ReportDay is one bucket of the daily sales series. The date is a plain
// YYYY-MM-DD in the CLIENT's timezone (the tz offset travels in the request),
// so "today" on the phone and "today" in the report agree.
type ReportDay struct {
	Date  string `json:"date"`
	Gross int64  `json:"gross"` // centimos charged to payers
	Fee   int64  `json:"fee"`   // centimos of merchant commission
	Net   int64  `json:"net"`   // gross - fee, what the shop keeps
	Count int    `json:"count"`
}

// ReportBucket aggregates sales for one location or one collector. An empty
// Key/Label is the "unattributed" bucket: sales before locations existed, or
// charges that did not pin one.
type ReportBucket struct {
	Key   string `json:"key,omitempty"`
	Label string `json:"label,omitempty"`
	Gross int64  `json:"gross"`
	Fee   int64  `json:"fee"`
	Net   int64  `json:"net"`
	Count int    `json:"count"`
}

type MerchantReport struct {
	Days        int            `json:"days"`
	Totals      ReportBucket   `json:"totals"`
	Daily       []ReportDay    `json:"daily"`
	ByLocation  []ReportBucket `json:"by_location"`
	ByCollector []ReportBucket `json:"by_collector"`
}

// AddStaffRequest identifies the employee by cedula: the owner types the same
// id the person registered with, so there is no free-form user search.
type AddStaffRequest struct {
	Cedula     string `json:"cedula"`
	Role       string `json:"role"`
	LocationID string `json:"location_id,omitempty"`
}

type UpdateStaffRequest struct {
	Role       string `json:"role"`
	LocationID string `json:"location_id,omitempty"`
}

type LocationRequest struct {
	Name    string `json:"name"`
	Address string `json:"address"`
	// Active only applies on update; nil keeps the current value.
	Active *bool `json:"active,omitempty"`
}

type CatalogItemRequest struct {
	Name       string `json:"name"`
	PriceMinor int64  `json:"price_minor"`
	Currency   string `json:"currency"`
	// Active/SortOrder only apply on update; nil keeps the current value.
	Active    *bool `json:"active,omitempty"`
	SortOrder *int  `json:"sort_order,omitempty"`
}

// VerificationDecisionRequest is the admin reject payload (reason is ignored on
// approve).
type VerificationDecisionRequest struct {
	Reason string `json:"reason,omitempty"`
}

// SetCommissionRequest is the admin payload to change a merchant's commission.
type SetCommissionRequest struct {
	CommissionBps int `json:"commission_bps"`
}

type ScanQRPaymentRequest struct {
	QRData   string `json:"qr_data"`
	Amount   int64  `json:"amount,omitempty"` // centimos, required if QR has no fixed amount
	Currency string `json:"currency"`
}
