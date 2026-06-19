package payout

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/kiramopay/backend/internal/middleware"
	"github.com/kiramopay/backend/pkg/response"
)

// Handler exposes the payout endpoints.
type Handler struct {
	service *Service
}

func NewHandler(service *Service) *Handler {
	return &Handler{service: service}
}

// Create handles POST /payouts.
func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	userID, ok := h.caller(w, r)
	if !ok {
		return
	}
	var req CreateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.Error(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}
	p, err := h.service.Create(r.Context(), userID, &req)
	if err != nil {
		h.writeError(w, err)
		return
	}
	response.JSON(w, http.StatusCreated, p)
}

// List handles GET /payouts.
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	userID, ok := h.caller(w, r)
	if !ok {
		return
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	items, err := h.service.List(r.Context(), userID, limit)
	if err != nil {
		h.writeError(w, err)
		return
	}
	response.JSON(w, http.StatusOK, items)
}

// Get handles GET /payouts/{id}.
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	userID, ok := h.caller(w, r)
	if !ok {
		return
	}
	p, err := h.service.Get(r.Context(), userID, chi.URLParam(r, "id"))
	if err != nil {
		h.writeError(w, err)
		return
	}
	response.JSON(w, http.StatusOK, p)
}

// Refresh handles POST /payouts/{id}/refresh — reconcile against the rail.
func (h *Handler) Refresh(w http.ResponseWriter, r *http.Request) {
	userID, ok := h.caller(w, r)
	if !ok {
		return
	}
	p, err := h.service.Refresh(r.Context(), userID, chi.URLParam(r, "id"))
	if err != nil {
		h.writeError(w, err)
		return
	}
	response.JSON(w, http.StatusOK, p)
}

// Rails handles GET /payouts/rails — the available rail names.
func (h *Handler) Rails(w http.ResponseWriter, r *http.Request) {
	response.JSON(w, http.StatusOK, map[string]any{"rails": h.service.Rails()})
}

func (h *Handler) caller(w http.ResponseWriter, r *http.Request) (string, bool) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		response.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "user not authenticated")
		return "", false
	}
	return userID, true
}

func (h *Handler) writeError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ErrNotFound):
		response.Error(w, http.StatusNotFound, "PAYOUT_NOT_FOUND", "payout not found")
	case errors.Is(err, ErrNotOwner):
		response.Error(w, http.StatusForbidden, "PAYOUT_FORBIDDEN", "you do not own this payout")
	case errors.Is(err, ErrUnknownRail):
		response.Error(w, http.StatusBadRequest, "PAYOUT_UNKNOWN_RAIL", "unknown payout rail")
	case errors.Is(err, ErrBadTransition):
		response.Error(w, http.StatusConflict, "PAYOUT_INVALID_STATE", "action not allowed in the current status")
	case errors.Is(err, ErrInsufficient):
		response.Error(w, http.StatusUnprocessableEntity, "INSUFFICIENT_BALANCE", "insufficient balance")
	case errors.Is(err, ErrMFARequired):
		response.Error(w, http.StatusForbidden, "MFA_REQUIRED", "verified MFA challenge required for this amount")
	case errors.Is(err, ErrInvalidRequest):
		response.Error(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
	default:
		response.Error(w, http.StatusInternalServerError, "PAYOUT_FAILED", "operation failed")
	}
}
