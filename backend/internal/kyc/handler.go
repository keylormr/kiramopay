package kyc

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

// Submit — POST /api/v1/kyc/submit
func (h *Handler) Submit(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	var req SubmitRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.Error(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}
	v, err := h.service.Submit(r.Context(), userID, &req, clientIP(r))
	if err != nil {
		response.Error(w, http.StatusBadRequest, "KYC_SUBMIT_FAILED", err.Error())
		return
	}
	response.JSON(w, http.StatusCreated, v)
}

// GetStatus — GET /api/v1/kyc/status
func (h *Handler) GetStatus(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	st, err := h.service.GetStatus(r.Context(), userID)
	if err != nil {
		response.Error(w, http.StatusInternalServerError, "KYC_STATUS_FAILED", err.Error())
		return
	}
	response.JSON(w, http.StatusOK, st)
}

// Decide — POST /api/v1/admin/kyc/{id}/decision (admin)
func (h *Handler) Decide(w http.ResponseWriter, r *http.Request) {
	adminID := middleware.GetUserID(r.Context())
	id := chi.URLParam(r, "id")
	var req DecisionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.Error(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}
	v, err := h.service.Decide(r.Context(), id, adminID, &req, clientIP(r))
	if err != nil {
		response.Error(w, http.StatusBadRequest, "KYC_DECISION_FAILED", err.Error())
		return
	}
	response.JSON(w, http.StatusOK, v)
}

func clientIP(r *http.Request) string {
	if ip := r.Header.Get("X-Forwarded-For"); ip != "" {
		return ip
	}
	return r.RemoteAddr
}
