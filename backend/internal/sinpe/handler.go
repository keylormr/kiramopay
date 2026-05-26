package sinpe

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/kiramopay/backend/internal/middleware"
	"github.com/kiramopay/backend/internal/transaction"
	"github.com/kiramopay/backend/pkg/response"
	"github.com/kiramopay/backend/pkg/validator"
)

type Handler struct {
	service *Service
}

func NewHandler(service *Service) *Handler {
	return &Handler{service: service}
}

func (h *Handler) GetContacts(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		response.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "user not authenticated")
		return
	}

	contacts, err := h.service.GetContacts(r.Context(), userID)
	if err != nil {
		response.Error(w, http.StatusInternalServerError, "FETCH_FAILED", err.Error())
		return
	}

	response.JSON(w, http.StatusOK, contacts)
}

func (h *Handler) AddContact(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		response.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "user not authenticated")
		return
	}

	var req struct {
		Phone string `json:"phone"`
		Name  string `json:"name"`
		Bank  string `json:"bank"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.Error(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}

	if err := validator.ValidatePhone(req.Phone); err != nil {
		response.Error(w, http.StatusBadRequest, "VALIDATION_ERROR", err.Message)
		return
	}
	if err := validator.ValidateRequired("name", req.Name); err != nil {
		response.Error(w, http.StatusBadRequest, "VALIDATION_ERROR", err.Message)
		return
	}

	contact, err := h.service.AddContact(r.Context(), userID, req.Phone, req.Name, req.Bank)
	if err != nil {
		response.Error(w, http.StatusBadRequest, "ADD_FAILED", err.Error())
		return
	}

	response.JSON(w, http.StatusCreated, contact)
}

func (h *Handler) GetHistory(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		response.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "user not authenticated")
		return
	}

	history, err := h.service.GetHistory(r.Context(), userID)
	if err != nil {
		response.Error(w, http.StatusInternalServerError, "FETCH_FAILED", err.Error())
		return
	}

	response.JSON(w, http.StatusOK, history)
}

func (h *Handler) Send(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		response.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "user not authenticated")
		return
	}

	var req SendRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.Error(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}

	if err := validator.ValidatePhone(req.Phone); err != nil {
		response.Error(w, http.StatusBadRequest, "VALIDATION_ERROR", err.Message)
		return
	}
	if req.Amount <= 0 {
		response.Error(w, http.StatusBadRequest, "VALIDATION_ERROR", "amount must be positive")
		return
	}

	ip := r.Header.Get("X-Forwarded-For")
	if ip == "" {
		raw := r.RemoteAddr
		if idx := strings.LastIndex(raw, ":"); idx > 0 {
			raw = raw[:idx]
		}
		ip = raw
	}

	result, err := h.service.Send(r.Context(), userID, &req, ip)
	if err != nil {
		if errors.Is(err, transaction.ErrMFARequired) {
			response.Error(w, http.StatusPreconditionRequired, "MFA_REQUIRED",
				"MFA challenge required for amounts >= 100,000 CRC")
			return
		}
		response.Error(w, http.StatusBadRequest, "SINPE_FAILED", err.Error())
		return
	}

	response.JSON(w, http.StatusOK, result)
}
