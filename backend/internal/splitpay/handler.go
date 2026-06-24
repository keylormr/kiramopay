package splitpay

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

func (h *Handler) CreateSplit(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	var req CreateSplitRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.Error(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}

	group, shares, err := h.service.CreateSplit(r.Context(), userID, &req)
	if err != nil {
		response.Error(w, http.StatusBadRequest, "CREATE_FAILED", err.Error())
		return
	}

	response.JSON(w, http.StatusCreated, map[string]interface{}{
		"group":  group,
		"shares": shares,
	})
}

func (h *Handler) GetSplit(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		response.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "user not authenticated")
		return
	}
	groupID := chi.URLParam(r, "id")
	group, shares, err := h.service.GetSplit(r.Context(), groupID)
	if err != nil {
		response.Error(w, http.StatusNotFound, "NOT_FOUND", err.Error())
		return
	}
	// Ownership check: only the creator or a participant may read the split (IDOR).
	allowed := group.CreatorID == userID
	for _, s := range shares {
		if s.UserID == userID {
			allowed = true
			break
		}
	}
	if !allowed {
		response.Error(w, http.StatusNotFound, "NOT_FOUND", "split not found")
		return
	}

	response.JSON(w, http.StatusOK, map[string]interface{}{
		"group":  group,
		"shares": shares,
	})
}

func (h *Handler) ListSplits(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	groups, err := h.service.ListUserSplits(r.Context(), userID)
	if err != nil {
		response.Error(w, http.StatusInternalServerError, "FETCH_FAILED", err.Error())
		return
	}
	response.JSON(w, http.StatusOK, groups)
}

func (h *Handler) PayShare(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	groupID := chi.URLParam(r, "id")

	if err := h.service.PayShare(r.Context(), userID, groupID); err != nil {
		response.Error(w, http.StatusBadRequest, "PAY_FAILED", err.Error())
		return
	}
	response.NoContent(w)
}

func (h *Handler) DeclineShare(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	groupID := chi.URLParam(r, "id")

	if err := h.service.DeclineShare(r.Context(), userID, groupID); err != nil {
		response.Error(w, http.StatusBadRequest, "DECLINE_FAILED", err.Error())
		return
	}
	response.NoContent(w)
}

func (h *Handler) CancelSplit(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	groupID := chi.URLParam(r, "id")

	if err := h.service.CancelSplit(r.Context(), userID, groupID); err != nil {
		response.Error(w, http.StatusBadRequest, "CANCEL_FAILED", err.Error())
		return
	}
	response.NoContent(w)
}
