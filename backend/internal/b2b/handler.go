package b2b

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/kiramopay/backend/internal/middleware"
	"github.com/kiramopay/backend/pkg/response"
)

// Handler exposes the B2B management endpoints (JWT-authenticated).
type Handler struct {
	service *Service
}

func NewHandler(service *Service) *Handler {
	return &Handler{service: service}
}

// CreateKey handles POST /b2b/keys.
func (h *Handler) CreateKey(w http.ResponseWriter, r *http.Request) {
	userID, ok := h.caller(w, r)
	if !ok {
		return
	}
	var body struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		response.Error(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}
	k, full, err := h.service.CreateKey(r.Context(), userID, body.Name)
	if err != nil {
		h.writeError(w, err)
		return
	}
	response.JSON(w, http.StatusCreated, map[string]any{
		"key":  k,
		"full": full, // shown exactly once — store it now
	})
}

// ListKeys handles GET /b2b/keys.
func (h *Handler) ListKeys(w http.ResponseWriter, r *http.Request) {
	userID, ok := h.caller(w, r)
	if !ok {
		return
	}
	keys, err := h.service.ListKeys(r.Context(), userID)
	if err != nil {
		h.writeError(w, err)
		return
	}
	response.JSON(w, http.StatusOK, keys)
}

// RevokeKey handles DELETE /b2b/keys/{id}.
func (h *Handler) RevokeKey(w http.ResponseWriter, r *http.Request) {
	userID, ok := h.caller(w, r)
	if !ok {
		return
	}
	if err := h.service.RevokeKey(r.Context(), userID, chi.URLParam(r, "id")); err != nil {
		h.writeError(w, err)
		return
	}
	response.JSON(w, http.StatusOK, map[string]string{"status": "revoked"})
}

// CreateWebhook handles POST /b2b/webhooks.
func (h *Handler) CreateWebhook(w http.ResponseWriter, r *http.Request) {
	userID, ok := h.caller(w, r)
	if !ok {
		return
	}
	var body struct {
		URL    string `json:"url"`
		Events string `json:"events"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		response.Error(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}
	e, err := h.service.CreateEndpoint(r.Context(), userID, body.URL, body.Events)
	if err != nil {
		h.writeError(w, err)
		return
	}
	response.JSON(w, http.StatusCreated, map[string]any{
		"endpoint": e,
		"secret":   e.Secret, // sign-verification secret for the merchant
	})
}

// ListWebhooks handles GET /b2b/webhooks.
func (h *Handler) ListWebhooks(w http.ResponseWriter, r *http.Request) {
	userID, ok := h.caller(w, r)
	if !ok {
		return
	}
	endpoints, err := h.service.ListEndpoints(r.Context(), userID)
	if err != nil {
		h.writeError(w, err)
		return
	}
	response.JSON(w, http.StatusOK, endpoints)
}

// DeleteWebhook handles DELETE /b2b/webhooks/{id}.
func (h *Handler) DeleteWebhook(w http.ResponseWriter, r *http.Request) {
	userID, ok := h.caller(w, r)
	if !ok {
		return
	}
	if err := h.service.DeleteEndpoint(r.Context(), userID, chi.URLParam(r, "id")); err != nil {
		h.writeError(w, err)
		return
	}
	response.JSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// ListDeliveries handles GET /b2b/webhooks/{id}/deliveries.
func (h *Handler) ListDeliveries(w http.ResponseWriter, r *http.Request) {
	userID, ok := h.caller(w, r)
	if !ok {
		return
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	items, err := h.service.RecentDeliveries(r.Context(), userID, chi.URLParam(r, "id"), limit)
	if err != nil {
		h.writeError(w, err)
		return
	}
	response.JSON(w, http.StatusOK, items)
}

// Ping handles GET /api/b2b/v1/ping — lets merchants verify a key works.
func (h *Handler) Ping(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	response.JSON(w, http.StatusOK, map[string]string{"status": "ok", "merchant_id": userID})
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
		response.Error(w, http.StatusNotFound, "B2B_NOT_FOUND", "resource not found")
	case errors.Is(err, ErrInvalid):
		response.Error(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
	default:
		response.Error(w, http.StatusInternalServerError, "B2B_FAILED", "operation failed")
	}
}
