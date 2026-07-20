package qrpayment

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/kiramopay/backend/internal/middleware"
	"github.com/kiramopay/backend/pkg/response"
)

type Handler struct {
	service *Service
}

func NewHandler(service *Service) *Handler {
	return &Handler{service: service}
}

// ── Merchants ────────────────────────────────────────────────────────────────

func (h *Handler) RegisterMerchant(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	var req RegisterMerchantRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.Error(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}

	merchant, err := h.service.RegisterMerchant(r.Context(), userID, &req)
	if err != nil {
		response.Error(w, http.StatusBadRequest, "REGISTER_FAILED", err.Error())
		return
	}
	response.JSON(w, http.StatusCreated, merchant)
}

// UpdateMerchant — PATCH /api/v1/qr/merchants/{id}. Owner-only; a change of
// legal identity sends the shop back to review (see service.UpdateMerchant).
func (h *Handler) UpdateMerchant(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	merchantID := chi.URLParam(r, "id")
	var req RegisterMerchantRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.Error(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}
	m, err := h.service.UpdateMerchant(r.Context(), merchantID, userID, &req)
	if err != nil {
		response.Error(w, http.StatusBadRequest, "UPDATE_FAILED", err.Error())
		return
	}
	response.JSON(w, http.StatusOK, m)
}

// GetMerchantBalance — GET /api/v1/qr/merchants/{id}/balance. Owner-only.
func (h *Handler) GetMerchantBalance(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	merchantID := chi.URLParam(r, "id")
	currency := r.URL.Query().Get("currency")
	if currency == "" {
		currency = "CRC"
	}
	bal, err := h.service.MerchantBalance(r.Context(), merchantID, userID, currency)
	if err != nil {
		response.Error(w, http.StatusNotFound, "NOT_FOUND", err.Error())
		return
	}
	response.JSON(w, http.StatusOK, map[string]any{"balance": bal, "currency": currency})
}

// WithdrawMerchant — POST /api/v1/qr/merchants/{id}/withdraw. Moves the shop's
// balance into the owner's personal wallet.
func (h *Handler) WithdrawMerchant(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	merchantID := chi.URLParam(r, "id")
	var req struct {
		Amount         int64  `json:"amount"`
		Currency       string `json:"currency"`
		IdempotencyKey string `json:"idempotency_key"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.Error(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}
	if err := h.service.WithdrawToOwner(r.Context(), merchantID, userID, req.Currency, req.Amount, req.IdempotencyKey); err != nil {
		response.Error(w, http.StatusBadRequest, "WITHDRAW_FAILED", err.Error())
		return
	}
	response.NoContent(w)
}

func (h *Handler) GetMerchants(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	merchants, err := h.service.GetMerchants(r.Context(), userID)
	if err != nil {
		response.Error(w, http.StatusInternalServerError, "FETCH_FAILED", err.Error())
		return
	}
	if merchants == nil {
		merchants = []Merchant{}
	}
	response.JSON(w, http.StatusOK, merchants)
}

// ── Admin: merchant verification ─────────────────────────────────────────────

func (h *Handler) ListPendingMerchants(w http.ResponseWriter, r *http.Request) {
	merchants, err := h.service.ListPendingMerchants(r.Context())
	if err != nil {
		response.Error(w, http.StatusInternalServerError, "FETCH_FAILED", err.Error())
		return
	}
	if merchants == nil {
		merchants = []Merchant{}
	}
	response.JSON(w, http.StatusOK, merchants)
}

func (h *Handler) ApproveMerchant(w http.ResponseWriter, r *http.Request) {
	adminID := middleware.GetUserID(r.Context())
	id := chi.URLParam(r, "id")
	merchant, err := h.service.ApproveMerchant(r.Context(), id, adminID)
	if err != nil {
		response.Error(w, http.StatusBadRequest, "APPROVE_FAILED", err.Error())
		return
	}
	response.JSON(w, http.StatusOK, merchant)
}

func (h *Handler) RejectMerchant(w http.ResponseWriter, r *http.Request) {
	adminID := middleware.GetUserID(r.Context())
	id := chi.URLParam(r, "id")
	var req VerificationDecisionRequest
	// Body is optional; an empty/invalid body just means no reason was given.
	_ = json.NewDecoder(r.Body).Decode(&req)
	merchant, err := h.service.RejectMerchant(r.Context(), id, adminID, req.Reason)
	if err != nil {
		response.Error(w, http.StatusBadRequest, "REJECT_FAILED", err.Error())
		return
	}
	response.JSON(w, http.StatusOK, merchant)
}

func (h *Handler) SetCommission(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req SetCommissionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.Error(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}
	merchant, err := h.service.SetCommission(r.Context(), id, req.CommissionBps)
	if err != nil {
		response.Error(w, http.StatusBadRequest, "SET_COMMISSION_FAILED", err.Error())
		return
	}
	response.JSON(w, http.StatusOK, merchant)
}

// ── QR Codes ─────────────────────────────────────────────────────────────────

func (h *Handler) CreateQRCode(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	var req CreateQRCodeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.Error(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}

	qr, err := h.service.CreateQRCode(r.Context(), userID, &req)
	if err != nil {
		response.Error(w, http.StatusBadRequest, "CREATE_FAILED", err.Error())
		return
	}
	response.JSON(w, http.StatusCreated, qr)
}

func (h *Handler) GetUserQRCodes(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	codes, err := h.service.GetUserQRCodes(r.Context(), userID)
	if err != nil {
		response.Error(w, http.StatusInternalServerError, "FETCH_FAILED", err.Error())
		return
	}
	response.JSON(w, http.StatusOK, codes)
}

// ── Scan & Pay ───────────────────────────────────────────────────────────────

func (h *Handler) ScanAndPay(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	var req ScanQRPaymentRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.Error(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}

	payment, err := h.service.ScanAndPay(r.Context(), userID, &req)
	if err != nil {
		response.Error(w, http.StatusBadRequest, "PAYMENT_FAILED", err.Error())
		return
	}
	response.JSON(w, http.StatusCreated, payment)
}

func (h *Handler) GetPaymentHistory(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	payments, err := h.service.GetPaymentHistory(r.Context(), userID)
	if err != nil {
		response.Error(w, http.StatusInternalServerError, "FETCH_FAILED", err.Error())
		return
	}
	response.JSON(w, http.StatusOK, payments)
}
