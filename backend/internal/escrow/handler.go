package escrow

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/kiramopay/backend/internal/middleware"
	"github.com/kiramopay/backend/pkg/response"
)

// Handler exposes the escrow endpoints.
type Handler struct {
	service *Service
}

func NewHandler(service *Service) *Handler {
	return &Handler{service: service}
}

// Create handles POST /escrow.
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
	a, err := h.service.Create(r.Context(), userID, &req)
	if err != nil {
		h.writeError(w, err)
		return
	}
	response.JSON(w, http.StatusCreated, a)
}

// List handles GET /escrow.
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

// Get handles GET /escrow/{id}.
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	userID, ok := h.caller(w, r)
	if !ok {
		return
	}
	a, err := h.service.Get(r.Context(), userID, chi.URLParam(r, "id"))
	if err != nil {
		h.writeError(w, err)
		return
	}
	response.JSON(w, http.StatusOK, a)
}

// Fund handles POST /escrow/{id}/fund.
func (h *Handler) Fund(w http.ResponseWriter, r *http.Request) {
	h.action(w, r, h.service.Fund)
}

// Release handles POST /escrow/{id}/release.
func (h *Handler) Release(w http.ResponseWriter, r *http.Request) {
	h.action(w, r, h.service.Release)
}

// Refund handles POST /escrow/{id}/refund.
func (h *Handler) Refund(w http.ResponseWriter, r *http.Request) {
	h.action(w, r, h.service.Refund)
}

// Cancel handles POST /escrow/{id}/cancel.
func (h *Handler) Cancel(w http.ResponseWriter, r *http.Request) {
	h.action(w, r, h.service.Cancel)
}

// Dispute handles POST /escrow/{id}/dispute.
func (h *Handler) Dispute(w http.ResponseWriter, r *http.Request) {
	userID, ok := h.caller(w, r)
	if !ok {
		return
	}
	var body struct {
		Reason string `json:"reason"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		response.Error(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}
	a, err := h.service.Dispute(r.Context(), userID, chi.URLParam(r, "id"), body.Reason)
	if err != nil {
		h.writeError(w, err)
		return
	}
	response.JSON(w, http.StatusOK, a)
}

// Resolve handles POST /admin/escrow/{id}/resolve (admin-gated at the route).
func (h *Handler) Resolve(w http.ResponseWriter, r *http.Request) {
	userID, ok := h.caller(w, r)
	if !ok {
		return
	}
	var body struct {
		Outcome string `json:"outcome"` // "released" | "refunded"
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		response.Error(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}
	a, err := h.service.Resolve(r.Context(), userID, chi.URLParam(r, "id"), Status(body.Outcome))
	if err != nil {
		h.writeError(w, err)
		return
	}
	response.JSON(w, http.StatusOK, a)
}

// action factors the common shape of the body-less transition endpoints.
func (h *Handler) action(
	w http.ResponseWriter, r *http.Request,
	fn func(ctx context.Context, callerID, id string) (*Agreement, error),
) {
	userID, ok := h.caller(w, r)
	if !ok {
		return
	}
	a, err := fn(r.Context(), userID, chi.URLParam(r, "id"))
	if err != nil {
		h.writeError(w, err)
		return
	}
	response.JSON(w, http.StatusOK, a)
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
		response.Error(w, http.StatusNotFound, "ESCROW_NOT_FOUND", "agreement not found")
	case errors.Is(err, ErrNotParty):
		response.Error(w, http.StatusForbidden, "ESCROW_FORBIDDEN", "not a party to this agreement")
	case errors.Is(err, ErrNotBuyer):
		response.Error(w, http.StatusForbidden, "ESCROW_BUYER_ONLY", "only the buyer may perform this action")
	case errors.Is(err, ErrNotSeller):
		response.Error(w, http.StatusForbidden, "ESCROW_SELLER_ONLY", "only the seller may perform this action")
	case errors.Is(err, ErrBadTransition):
		response.Error(w, http.StatusConflict, "ESCROW_INVALID_STATE", "action not allowed in the current status")
	case errors.Is(err, ErrInsufficient):
		response.Error(w, http.StatusUnprocessableEntity, "INSUFFICIENT_BALANCE", "insufficient balance")
	case errors.Is(err, ErrMFARequired):
		response.Error(w, http.StatusForbidden, "MFA_REQUIRED", "verified MFA challenge required for this amount")
	case errors.Is(err, ErrInvalidRequest):
		response.Error(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
	default:
		response.Error(w, http.StatusInternalServerError, "ESCROW_FAILED", "operation failed")
	}
}
