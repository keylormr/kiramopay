package recurring

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

func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	payments, err := h.service.List(r.Context(), userID)
	if err != nil {
		response.Error(w, http.StatusInternalServerError, "FETCH_FAILED", err.Error())
		return
	}
	if payments == nil {
		payments = []RecurringPaymentRecord{}
	}
	response.JSON(w, http.StatusOK, payments)
}

func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	var req CreateRecurringRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.Error(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}

	payment, err := h.service.Create(r.Context(), userID, &req)
	if err != nil {
		response.Error(w, http.StatusBadRequest, "CREATE_FAILED", err.Error())
		return
	}
	response.JSON(w, http.StatusCreated, payment)
}

func (h *Handler) Update(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	paymentID := chi.URLParam(r, "id")

	var req UpdateRecurringRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.Error(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}

	if err := h.service.Update(r.Context(), paymentID, userID, &req); err != nil {
		response.Error(w, http.StatusBadRequest, "UPDATE_FAILED", err.Error())
		return
	}
	response.JSON(w, http.StatusOK, map[string]bool{"updated": true})
}

func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	paymentID := chi.URLParam(r, "id")

	if err := h.service.Delete(r.Context(), paymentID, userID); err != nil {
		response.Error(w, http.StatusBadRequest, "DELETE_FAILED", err.Error())
		return
	}
	response.NoContent(w)
}

func (h *Handler) Toggle(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	paymentID := chi.URLParam(r, "id")

	enabled, err := h.service.Toggle(r.Context(), paymentID, userID)
	if err != nil {
		response.Error(w, http.StatusBadRequest, "TOGGLE_FAILED", err.Error())
		return
	}
	response.JSON(w, http.StatusOK, map[string]bool{"enabled": enabled})
}

func (h *Handler) MarkPaid(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	paymentID := chi.URLParam(r, "id")

	payment, err := h.service.MarkPaid(r.Context(), paymentID, userID)
	if err != nil {
		response.Error(w, http.StatusBadRequest, "MARK_PAID_FAILED", err.Error())
		return
	}
	response.JSON(w, http.StatusOK, payment)
}
