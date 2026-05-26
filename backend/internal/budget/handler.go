package budget

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
	budgets, err := h.service.List(r.Context(), userID)
	if err != nil {
		response.Error(w, http.StatusInternalServerError, "FETCH_FAILED", err.Error())
		return
	}
	if budgets == nil {
		budgets = []BudgetRecord{}
	}
	response.JSON(w, http.StatusOK, budgets)
}

func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	var req CreateBudgetRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.Error(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}

	budget, err := h.service.Create(r.Context(), userID, &req)
	if err != nil {
		response.Error(w, http.StatusBadRequest, "CREATE_FAILED", err.Error())
		return
	}
	response.JSON(w, http.StatusCreated, budget)
}

func (h *Handler) Update(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	budgetID := chi.URLParam(r, "id")

	var req UpdateBudgetRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.Error(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}

	if err := h.service.Update(r.Context(), budgetID, userID, &req); err != nil {
		response.Error(w, http.StatusBadRequest, "UPDATE_FAILED", err.Error())
		return
	}
	response.JSON(w, http.StatusOK, map[string]bool{"updated": true})
}

func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	budgetID := chi.URLParam(r, "id")

	if err := h.service.Delete(r.Context(), budgetID, userID); err != nil {
		response.Error(w, http.StatusBadRequest, "DELETE_FAILED", err.Error())
		return
	}
	response.NoContent(w)
}

func (h *Handler) ResetAll(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if err := h.service.ResetAll(r.Context(), userID); err != nil {
		response.Error(w, http.StatusInternalServerError, "RESET_FAILED", err.Error())
		return
	}
	response.JSON(w, http.StatusOK, map[string]bool{"reset": true})
}
