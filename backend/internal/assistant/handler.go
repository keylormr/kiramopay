package assistant

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/kiramopay/backend/internal/middleware"
	"github.com/kiramopay/backend/pkg/response"
)

// Handler exposes the assistant endpoints.
type Handler struct {
	service *Service
	conv    *ConversationService // nil ⇒ history endpoints report unavailable
}

func NewHandler(service *Service, conv *ConversationService) *Handler {
	return &Handler{service: service, conv: conv}
}

// Status handles GET /assistant/status — lets the UI show/hide the assistant.
func (h *Handler) Status(w http.ResponseWriter, _ *http.Request) {
	response.JSON(w, http.StatusOK, map[string]bool{"available": h.service.Available()})
}

// Chat handles POST /assistant/chat.
func (h *Handler) Chat(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		response.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "user not authenticated")
		return
	}
	var req ChatRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.Error(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}
	res, err := h.service.Chat(r.Context(), userID, &req)
	if err != nil {
		h.writeError(w, err)
		return
	}
	response.JSON(w, http.StatusOK, res)
}

// ListConversations handles GET /assistant/conversations.
func (h *Handler) ListConversations(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		response.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "user not authenticated")
		return
	}
	if h.conv == nil {
		response.Error(w, http.StatusServiceUnavailable, "ASSISTANT_UNAVAILABLE", "the assistant is not available")
		return
	}
	items, err := h.conv.List(r.Context(), userID)
	if err != nil {
		response.Error(w, http.StatusInternalServerError, "ASSISTANT_FAILED", "operation failed")
		return
	}
	response.JSON(w, http.StatusOK, map[string]any{"conversations": items})
}

// GetConversation handles GET /assistant/conversations/{id}.
func (h *Handler) GetConversation(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		response.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "user not authenticated")
		return
	}
	if h.conv == nil {
		response.Error(w, http.StatusServiceUnavailable, "ASSISTANT_UNAVAILABLE", "the assistant is not available")
		return
	}
	c, err := h.conv.Get(r.Context(), userID, chi.URLParam(r, "id"))
	if err != nil {
		h.writeError(w, err)
		return
	}
	response.JSON(w, http.StatusOK, c)
}

// CreateConversation handles POST /assistant/conversations.
func (h *Handler) CreateConversation(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		response.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "user not authenticated")
		return
	}
	if h.conv == nil {
		response.Error(w, http.StatusServiceUnavailable, "ASSISTANT_UNAVAILABLE", "the assistant is not available")
		return
	}
	c, err := h.conv.Create(r.Context(), userID)
	if err != nil {
		h.writeError(w, err)
		return
	}
	response.JSON(w, http.StatusCreated, c)
}

// DeleteConversation handles DELETE /assistant/conversations/{id}.
func (h *Handler) DeleteConversation(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		response.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "user not authenticated")
		return
	}
	if h.conv == nil {
		response.Error(w, http.StatusServiceUnavailable, "ASSISTANT_UNAVAILABLE", "the assistant is not available")
		return
	}
	if err := h.conv.Delete(r.Context(), userID, chi.URLParam(r, "id")); err != nil {
		h.writeError(w, err)
		return
	}
	response.NoContent(w)
}

func (h *Handler) writeError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ErrUnavailable):
		response.Error(w, http.StatusServiceUnavailable, "ASSISTANT_UNAVAILABLE", "the assistant is not available")
	case errors.Is(err, ErrInvalidRequest):
		response.Error(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
	case errors.Is(err, ErrQuota):
		response.Error(w, http.StatusTooManyRequests, "ASSISTANT_QUOTA", "daily assistant limit reached")
	case errors.Is(err, ErrAssistantBusy):
		response.Error(w, http.StatusTooManyRequests, "ASSISTANT_BUSY", "assistant temporarily at capacity")
	case errors.Is(err, ErrConvNotFound):
		response.Error(w, http.StatusNotFound, "CONVERSATION_NOT_FOUND", "conversation not found")
	case errors.Is(err, ErrConvLimit):
		response.Error(w, http.StatusConflict, "CONVERSATION_LIMIT", "conversation limit reached for your plan")
	case errors.Is(err, ErrLLM):
		response.Error(w, http.StatusBadGateway, "ASSISTANT_FAILED", "the assistant could not answer right now")
	default:
		response.Error(w, http.StatusInternalServerError, "ASSISTANT_FAILED", "operation failed")
	}
}
