package payment

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

func (h *Handler) PayBill(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		response.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "user not authenticated")
		return
	}

	var req PayBillRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.Error(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}

	if req.ProviderCode == "" || req.ClientID == "" || req.Amount <= 0 {
		response.Error(w, http.StatusBadRequest, "VALIDATION_ERROR", "provider_code, client_id, and amount are required")
		return
	}

	result, err := h.service.PayBill(r.Context(), userID, &req)
	if err != nil {
		response.Error(w, http.StatusBadRequest, "PAYMENT_FAILED", err.Error())
		return
	}

	response.JSON(w, http.StatusOK, result)
}

func (h *Handler) Recharge(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		response.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "user not authenticated")
		return
	}

	var req RechargeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.Error(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}

	if req.Operator == "" || req.Phone == "" || req.Amount <= 0 {
		response.Error(w, http.StatusBadRequest, "VALIDATION_ERROR", "operator, phone, and amount are required")
		return
	}

	result, err := h.service.Recharge(r.Context(), userID, &req)
	if err != nil {
		response.Error(w, http.StatusBadRequest, "RECHARGE_FAILED", err.Error())
		return
	}

	response.JSON(w, http.StatusOK, result)
}

func (h *Handler) GetSavedServices(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		response.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "user not authenticated")
		return
	}

	services, err := h.service.GetSavedServices(r.Context(), userID)
	if err != nil {
		response.Error(w, http.StatusInternalServerError, "FETCH_FAILED", err.Error())
		return
	}

	response.JSON(w, http.StatusOK, services)
}

func (h *Handler) AddSavedService(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		response.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "user not authenticated")
		return
	}

	var req struct {
		ProviderCode string `json:"provider_code"`
		ClientID     string `json:"client_id"`
		Nickname     string `json:"nickname"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.Error(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}

	service, err := h.service.AddSavedService(r.Context(), userID, req.ProviderCode, req.ClientID, req.Nickname)
	if err != nil {
		response.Error(w, http.StatusBadRequest, "ADD_FAILED", err.Error())
		return
	}

	response.JSON(w, http.StatusCreated, service)
}

func (h *Handler) GetPaymentHistory(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		response.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "user not authenticated")
		return
	}

	history, err := h.service.GetPaymentHistory(r.Context(), userID)
	if err != nil {
		response.Error(w, http.StatusInternalServerError, "FETCH_FAILED", err.Error())
		return
	}

	response.JSON(w, http.StatusOK, history)
}
