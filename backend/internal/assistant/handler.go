package assistant

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/kiramopay/backend/internal/middleware"
	"github.com/kiramopay/backend/pkg/response"
)

// Handler exposes the assistant endpoints.
type Handler struct {
	service *Service
}

func NewHandler(service *Service) *Handler {
	return &Handler{service: service}
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

func (h *Handler) writeError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ErrUnavailable):
		response.Error(w, http.StatusServiceUnavailable, "ASSISTANT_UNAVAILABLE", "the assistant is not available")
	case errors.Is(err, ErrInvalidRequest):
		response.Error(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
	case errors.Is(err, ErrLLM):
		response.Error(w, http.StatusBadGateway, "ASSISTANT_FAILED", "the assistant could not answer right now")
	default:
		response.Error(w, http.StatusInternalServerError, "ASSISTANT_FAILED", "operation failed")
	}
}
