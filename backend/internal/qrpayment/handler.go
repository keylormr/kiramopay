package qrpayment

import (
	"encoding/json"
	"net/http"

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

func (h *Handler) GetMerchant(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	merchant, err := h.service.GetMerchant(r.Context(), userID)
	if err != nil {
		response.Error(w, http.StatusNotFound, "NOT_FOUND", "merchant profile not found")
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
