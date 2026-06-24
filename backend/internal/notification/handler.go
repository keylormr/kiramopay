package notification

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/kiramopay/backend/internal/middleware"
	"github.com/kiramopay/backend/pkg/response"
)

// Handler handles notification HTTP endpoints.
type Handler struct {
	service *Service
}

// NewHandler creates a new notification handler.
func NewHandler(service *Service) *Handler {
	return &Handler{service: service}
}

// Subscribe registers a push subscription.
func (h *Handler) Subscribe(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())

	var req SubscribeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.Error(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}

	if req.Endpoint == "" {
		response.Error(w, http.StatusBadRequest, "MISSING_ENDPOINT", "endpoint is required")
		return
	}

	if err := h.service.Subscribe(r.Context(), userID, &req); err != nil {
		response.Error(w, http.StatusInternalServerError, "SUBSCRIBE_FAILED", err.Error())
		return
	}

	response.JSON(w, http.StatusCreated, map[string]string{"status": "subscribed"})
}

// Unsubscribe removes a push subscription.
func (h *Handler) Unsubscribe(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())

	var req struct {
		Endpoint string `json:"endpoint"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.Error(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}

	if err := h.service.Unsubscribe(r.Context(), userID, req.Endpoint); err != nil {
		response.Error(w, http.StatusInternalServerError, "UNSUBSCRIBE_FAILED", err.Error())
		return
	}

	response.NoContent(w)
}

// ListNotifications returns paginated notification history.
func (h *Handler) ListNotifications(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())

	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))

	notifs, err := h.service.ListHistory(r.Context(), userID, limit, offset)
	if err != nil {
		response.Error(w, http.StatusInternalServerError, "LIST_FAILED", err.Error())
		return
	}

	response.JSON(w, http.StatusOK, notifs)
}

// MarkRead marks a notification as read.
func (h *Handler) MarkRead(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	notifID := chi.URLParam(r, "id")

	if err := h.service.MarkRead(r.Context(), userID, notifID); err != nil {
		response.Error(w, http.StatusInternalServerError, "MARK_READ_FAILED", err.Error())
		return
	}

	response.NoContent(w)
}

// MarkAllRead marks all of the user's notifications as read.
func (h *Handler) MarkAllRead(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())

	if err := h.service.MarkAllRead(r.Context(), userID); err != nil {
		response.Error(w, http.StatusInternalServerError, "MARK_ALL_READ_FAILED", err.Error())
		return
	}

	response.NoContent(w)
}
