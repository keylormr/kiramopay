package qrpayment

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/kiramopay/backend/internal/transaction"
	"github.com/kiramopay/backend/internal/user"
)

// userLookup resolves an employee from the cedula the owner types when adding
// staff. Satisfied by *user.Repository.
type userLookup interface {
	FindByCedula(ctx context.Context, cedula string) (*user.UserRecord, error)
}

type Service struct {
	repo  *Repository
	tx    *transaction.Service
	users userLookup
}

func NewService(repo *Repository, tx *transaction.Service, users userLookup) *Service {
	return &Service{repo: repo, tx: tx, users: users}
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

// GetMerchants returns every merchant profile the user can act on: the ones
// they OWN (role "owner") plus the ones they work for as active staff (role
// "cashier"/"manager"). The role field tells the client which UI to show.
func (s *Service) GetMerchants(ctx context.Context, userID string) ([]Merchant, error) {
	owned, err := s.repo.GetMerchantsByUserID(ctx, userID)
	if err != nil {
		return nil, err
	}
	for i := range owned {
		owned[i].Role = RoleOwner
	}
	staffed, err := s.repo.GetMerchantsByStaffUserID(ctx, userID)
	if err != nil {
		return nil, err
	}
	return append(owned, staffed...), nil
}

// roleFor resolves how a user relates to a merchant: "owner", an active staff
// role ("manager"/"cashier"), or "" when they have no business acting on it.
func (s *Service) roleFor(ctx context.Context, merchantID, userID string) (string, *Merchant, error) {
	m, err := s.repo.GetMerchant(ctx, merchantID)
	if err != nil {
		return "", nil, fmt.Errorf("merchant not found")
	}
	if m.UserID == userID {
		return RoleOwner, m, nil
	}
	role, err := s.repo.GetStaffRole(ctx, merchantID, userID)
	if err != nil {
		return "", nil, err
	}
	return role, m, nil
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

	var merchantID, locationID string
	if req.Type == "merchant_fixed" || req.Type == "merchant_dynamic" {
		if req.MerchantID == "" {
			return nil, fmt.Errorf("merchant_id is required for merchant QR codes")
		}
		// Any team member can charge for the shop: the money lands in the
		// MERCHANT wallet either way, so a cashier generating a QR moves
		// nothing into their own pocket.
		role, merchant, err := s.roleFor(ctx, req.MerchantID, userID)
		if err != nil {
			return nil, fmt.Errorf("merchant profile not found")
		}
		if role == "" {
			return nil, fmt.Errorf("merchant does not belong to user")
		}
		if merchant.VerificationStatus != "verified" {
			return nil, fmt.Errorf("merchant is pending verification")
		}
		merchantID = merchant.ID
		if req.LocationID != "" {
			loc, err := s.repo.GetLocation(ctx, merchantID, req.LocationID)
			if err != nil || !loc.Active {
				return nil, fmt.Errorf("location not found")
			}
			locationID = loc.ID
		}
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
		LocationID: locationID,
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

	// Attribution: a merchant charge remembers which location it was for and
	// which team member (QR creator) generated it — that is what per-location
	// and per-cashier sales reporting hang off.
	collectedBy := ""
	if qr.MerchantID != "" {
		collectedBy = qr.CreatorID
	}
	payment := &QRPaymentRecord{
		ID:          uuid.New().String(),
		QRCodeID:    qr.ID,
		PayerID:     payerID,
		ReceiverID:  qr.CreatorID,
		MerchantID:  qr.MerchantID,
		LocationID:  qr.LocationID,
		CollectedBy: collectedBy,
		Amount:      amount,
		Fee:         fee,
		Currency:    currency,
		Status:      "completed",
		Note:        qr.Note,
		TxID:        sender.ID,
		CreatedAt:   time.Now(),
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
// the journal. Owner and manager only — a cashier collects but does not see
// the till.
func (s *Service) MerchantBalance(ctx context.Context, merchantID, userID, currency string) (int64, error) {
	role, _, err := s.roleFor(ctx, merchantID, userID)
	if err != nil || (role != RoleOwner && role != RoleManager) {
		return 0, fmt.Errorf("merchant not found")
	}
	return s.tx.MerchantBalance(ctx, merchantID, currency)
}

// MerchantPayments is the shop's sales feed, visible to the whole team.
func (s *Service) MerchantPayments(ctx context.Context, merchantID, userID string, limit int) ([]QRPaymentRecord, error) {
	role, _, err := s.roleFor(ctx, merchantID, userID)
	if err != nil || role == "" {
		return nil, fmt.Errorf("merchant not found")
	}
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	return s.repo.GetMerchantPayments(ctx, merchantID, limit)
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

// ── Team: staff, locations, catalog (phase 3) ────────────────────────────────

// requireRole resolves the caller's role on the merchant and rejects the call
// unless it is one of the allowed roles.
func (s *Service) requireRole(ctx context.Context, merchantID, userID string, allowed ...string) (*Merchant, error) {
	role, m, err := s.roleFor(ctx, merchantID, userID)
	if err != nil {
		return nil, err
	}
	for _, a := range allowed {
		if role == a {
			return m, nil
		}
	}
	// Same message whether the shop does not exist or the caller lacks the
	// role: no probing which merchant ids are real.
	return nil, fmt.Errorf("merchant not found")
}

// ListStaff — owner only. The team roster includes revoked rows for history.
func (s *Service) ListStaff(ctx context.Context, merchantID, userID string) ([]StaffMember, error) {
	if _, err := s.requireRole(ctx, merchantID, userID, RoleOwner); err != nil {
		return nil, err
	}
	return s.repo.ListStaff(ctx, merchantID)
}

// AddStaff — owner only. The employee is identified by the cedula they
// registered with; adding someone already revoked reactivates them.
func (s *Service) AddStaff(ctx context.Context, merchantID, userID string, req *AddStaffRequest) (*StaffMember, error) {
	m, err := s.requireRole(ctx, merchantID, userID, RoleOwner)
	if err != nil {
		return nil, err
	}
	if req.Role != RoleCashier && req.Role != RoleManager {
		return nil, fmt.Errorf("invalid role")
	}
	cedula := strings.TrimSpace(req.Cedula)
	if cedula == "" {
		return nil, fmt.Errorf("cedula is required")
	}
	employee, err := s.users.FindByCedula(ctx, cedula)
	if err != nil {
		return nil, fmt.Errorf("no KiramoPay user with that cedula")
	}
	if employee.ID == m.UserID {
		return nil, fmt.Errorf("the owner is already part of the business")
	}
	if req.LocationID != "" {
		if loc, err := s.repo.GetLocation(ctx, merchantID, req.LocationID); err != nil || !loc.Active {
			return nil, fmt.Errorf("location not found")
		}
	}
	return s.repo.UpsertStaff(ctx, merchantID, employee.ID, req.Role, req.LocationID, userID)
}

// UpdateStaff — owner only. Changes role and/or location of an active member.
func (s *Service) UpdateStaff(ctx context.Context, merchantID, userID, staffID string, req *UpdateStaffRequest) (*StaffMember, error) {
	if _, err := s.requireRole(ctx, merchantID, userID, RoleOwner); err != nil {
		return nil, err
	}
	if req.Role != RoleCashier && req.Role != RoleManager {
		return nil, fmt.Errorf("invalid role")
	}
	if req.LocationID != "" {
		if loc, err := s.repo.GetLocation(ctx, merchantID, req.LocationID); err != nil || !loc.Active {
			return nil, fmt.Errorf("location not found")
		}
	}
	return s.repo.UpdateStaff(ctx, merchantID, staffID, req.Role, req.LocationID)
}

// RevokeStaff — owner only.
func (s *Service) RevokeStaff(ctx context.Context, merchantID, userID, staffID string) error {
	if _, err := s.requireRole(ctx, merchantID, userID, RoleOwner); err != nil {
		return err
	}
	return s.repo.RevokeStaff(ctx, merchantID, staffID)
}

// ListLocations — whole team (a cashier picks their location when charging).
func (s *Service) ListLocations(ctx context.Context, merchantID, userID string) ([]Location, error) {
	if _, err := s.requireRole(ctx, merchantID, userID, RoleOwner, RoleManager, RoleCashier); err != nil {
		return nil, err
	}
	return s.repo.ListLocations(ctx, merchantID)
}

// CreateLocation — owner or manager.
func (s *Service) CreateLocation(ctx context.Context, merchantID, userID string, req *LocationRequest) (*Location, error) {
	if _, err := s.requireRole(ctx, merchantID, userID, RoleOwner, RoleManager); err != nil {
		return nil, err
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		return nil, fmt.Errorf("location name is required")
	}
	return s.repo.CreateLocation(ctx, merchantID, name, strings.TrimSpace(req.Address))
}

// UpdateLocation — owner or manager. A location with sales history is
// deactivated (active=false), never deleted, so attribution survives.
func (s *Service) UpdateLocation(ctx context.Context, merchantID, userID, locationID string, req *LocationRequest) (*Location, error) {
	if _, err := s.requireRole(ctx, merchantID, userID, RoleOwner, RoleManager); err != nil {
		return nil, err
	}
	current, err := s.repo.GetLocation(ctx, merchantID, locationID)
	if err != nil {
		return nil, fmt.Errorf("location not found")
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		name = current.Name
	}
	address := strings.TrimSpace(req.Address)
	active := current.Active
	if req.Active != nil {
		active = *req.Active
	}
	return s.repo.UpdateLocation(ctx, merchantID, locationID, name, address, active)
}

// ListCatalog — whole team (charging from the catalog needs the prices).
func (s *Service) ListCatalog(ctx context.Context, merchantID, userID string) ([]CatalogItem, error) {
	if _, err := s.requireRole(ctx, merchantID, userID, RoleOwner, RoleManager, RoleCashier); err != nil {
		return nil, err
	}
	return s.repo.ListCatalog(ctx, merchantID)
}

// CreateCatalogItem — owner or manager. Prices are minor units, positive.
func (s *Service) CreateCatalogItem(ctx context.Context, merchantID, userID string, req *CatalogItemRequest) (*CatalogItem, error) {
	if _, err := s.requireRole(ctx, merchantID, userID, RoleOwner, RoleManager); err != nil {
		return nil, err
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		return nil, fmt.Errorf("item name is required")
	}
	if req.PriceMinor <= 0 {
		return nil, fmt.Errorf("price must be positive")
	}
	currency := req.Currency
	if currency == "" {
		currency = "CRC"
	}
	sortOrder := 0
	if req.SortOrder != nil {
		sortOrder = *req.SortOrder
	}
	return s.repo.CreateCatalogItem(ctx, merchantID, name, req.PriceMinor, currency, sortOrder)
}

// UpdateCatalogItem — owner or manager.
func (s *Service) UpdateCatalogItem(ctx context.Context, merchantID, userID, itemID string, req *CatalogItemRequest) (*CatalogItem, error) {
	if _, err := s.requireRole(ctx, merchantID, userID, RoleOwner, RoleManager); err != nil {
		return nil, err
	}
	current, err := s.repo.ListCatalog(ctx, merchantID)
	if err != nil {
		return nil, err
	}
	var existing *CatalogItem
	for i := range current {
		if current[i].ID == itemID {
			existing = &current[i]
			break
		}
	}
	if existing == nil {
		return nil, fmt.Errorf("catalog item not found")
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		name = existing.Name
	}
	price := req.PriceMinor
	if price == 0 {
		price = existing.PriceMinor
	}
	if price <= 0 {
		return nil, fmt.Errorf("price must be positive")
	}
	active := existing.Active
	if req.Active != nil {
		active = *req.Active
	}
	sortOrder := existing.SortOrder
	if req.SortOrder != nil {
		sortOrder = *req.SortOrder
	}
	return s.repo.UpdateCatalogItem(ctx, merchantID, itemID, name, price, active, sortOrder)
}

// DeleteCatalogItem — owner or manager. Payment history only stores totals and
// a note, so removing an item never breaks past sales.
func (s *Service) DeleteCatalogItem(ctx context.Context, merchantID, userID, itemID string) error {
	if _, err := s.requireRole(ctx, merchantID, userID, RoleOwner, RoleManager); err != nil {
		return err
	}
	return s.repo.DeleteCatalogItem(ctx, merchantID, itemID)
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
