package uif

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

// ListReports — GET /api/v1/admin/uif/reports?status=pending
func (h *Handler) ListReports(w http.ResponseWriter, r *http.Request) {
	status := r.URL.Query().Get("status")
	reports, err := h.service.ListReports(r.Context(), status)
	if err != nil {
		response.Error(w, http.StatusInternalServerError, "UIF_LIST_FAILED", err.Error())
		return
	}
	response.JSON(w, http.StatusOK, reports)
}

// Review — POST /api/v1/admin/uif/reports/{id}/review
func (h *Handler) Review(w http.ResponseWriter, r *http.Request) {
	reviewerID := middleware.GetUserID(r.Context())
	id := chi.URLParam(r, "id")
	var req ReviewRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.Error(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}
	if err := h.service.ReviewReport(r.Context(), id, reviewerID, &req); err != nil {
		response.Error(w, http.StatusBadRequest, "UIF_REVIEW_FAILED", err.Error())
		return
	}
	response.NoContent(w)
}
