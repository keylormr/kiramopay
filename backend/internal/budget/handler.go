package budget

import (
	"encoding/json"
	"errors"
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
		escribirError(w, err, "CREATE_FAILED")
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
		escribirError(w, err, "UPDATE_FAILED")
		return
	}
	response.JSON(w, http.StatusOK, map[string]bool{"updated": true})
}

func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	budgetID := chi.URLParam(r, "id")

	if err := h.service.Delete(r.Context(), budgetID, userID); err != nil {
		escribirError(w, err, "DELETE_FAILED")
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

// escribirError da a cada rechazo su codigo; lo que no es un rechazo es una
// falla del servidor y sale como 5xx con el codigo de la operacion, sin el
// texto del driver (response.Error lo reemplaza en los 5xx).
func escribirError(w http.ResponseWriter, err error, codigoDeFalla string) {
	switch {
	case errors.Is(err, ErrNoEncontrado):
		response.Error(w, http.StatusNotFound, "BUDGET_NOT_FOUND", "budget not found")
	case errors.Is(err, ErrNombreRequerido):
		response.Error(w, http.StatusBadRequest, "BUDGET_LABEL_REQUIRED", "the budget needs a label")
	case errors.Is(err, ErrNombreMuyLargo):
		response.Error(w, http.StatusBadRequest, "BUDGET_LABEL_TOO_LONG", "the label can have up to 100 characters")
	case errors.Is(err, ErrTopeInvalido):
		response.Error(w, http.StatusBadRequest, "BUDGET_INVALID_LIMIT", "amount_limit must be greater than zero")
	case errors.Is(err, ErrGastadoInvalido):
		response.Error(w, http.StatusBadRequest, "BUDGET_INVALID_SPENT", "amount_spent cannot be negative")
	case errors.Is(err, ErrCampoInvalido):
		response.Error(w, http.StatusBadRequest, "BUDGET_INVALID_FIELD",
			"currency must be CRC or USD, period must be monthly, icon up to 50 characters and color up to 20")
	default:
		response.Error(w, http.StatusInternalServerError, codigoDeFalla, err.Error())
	}
}
