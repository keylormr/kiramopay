package kyc

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

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

// LookupBusinessCedula — POST /api/v1/kyc/business-lookup
//
// Takes the cedula in the body (never the query string, so it stays out of
// URLs, logs and referrers) and returns only the registered name + id type.
// The route is rate limited per user to keep it from becoming a cedula-to-name
// enumeration service.
func (h *Handler) LookupBusinessCedula(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	var req struct {
		Cedula string `json:"cedula"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.Error(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}
	res, err := h.service.LookupBusinessCedula(r.Context(), userID, strings.TrimSpace(req.Cedula), clientIP(r))
	if err != nil {
		if errors.Is(err, ErrIdentityNotFound) {
			response.Error(w, http.StatusNotFound, "CEDULA_NOT_FOUND", "cedula not found in the public registry")
			return
		}
		response.Error(w, http.StatusServiceUnavailable, "IDENTITY_UNAVAILABLE", "registry unavailable, try again later")
		return
	}
	response.JSON(w, http.StatusOK, res)
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

// VerifyIdentity — POST /api/v1/kyc/verify-identity
// Automated N1 check against the Hacienda registry for the authed user's own
// registered cedula. No request body (the id/name come from the account).
func (h *Handler) VerifyIdentity(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	res, err := h.service.VerifyIdentity(r.Context(), userID, clientIP(r))
	if err != nil {
		if errors.Is(err, ErrIdentityUnavailable) {
			response.Error(w, http.StatusServiceUnavailable, "IDENTITY_UNAVAILABLE", "identity service unavailable, try again later")
			return
		}
		response.Error(w, http.StatusBadRequest, "IDENTITY_VERIFY_FAILED", err.Error())
		return
	}
	response.JSON(w, http.StatusOK, res)
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
