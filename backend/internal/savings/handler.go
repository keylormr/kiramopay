package savings

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
	goals, err := h.service.List(r.Context(), userID)
	if err != nil {
		response.Error(w, http.StatusInternalServerError, "FETCH_FAILED", err.Error())
		return
	}
	if goals == nil {
		goals = []Goal{}
	}
	response.JSON(w, http.StatusOK, goals)
}

func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	var req CreateGoalRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.Error(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}
	g, err := h.service.Create(r.Context(), userID, &req)
	if err != nil {
		response.Error(w, http.StatusBadRequest, "CREATE_FAILED", err.Error())
		return
	}
	response.JSON(w, http.StatusCreated, g)
}

func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	id := chi.URLParam(r, "id")
	if err := h.service.Delete(r.Context(), userID, id); err != nil {
		response.Error(w, http.StatusBadRequest, "DELETE_FAILED", err.Error())
		return
	}
	response.JSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

func (h *Handler) Deposit(w http.ResponseWriter, r *http.Request)  { h.move(w, r, true) }
func (h *Handler) Withdraw(w http.ResponseWriter, r *http.Request) { h.move(w, r, false) }

func (h *Handler) move(w http.ResponseWriter, r *http.Request, deposit bool) {
	userID := middleware.GetUserID(r.Context())
	id := chi.URLParam(r, "id")
	var req AmountRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.Error(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}
	var (
		g   *Goal
		err error
	)
	if deposit {
		g, err = h.service.Deposit(r.Context(), userID, id, req.AmountMinor)
	} else {
		g, err = h.service.Withdraw(r.Context(), userID, id, req.AmountMinor)
	}
	if err != nil {
		response.Error(w, http.StatusBadRequest, "SAVINGS_FAILED", err.Error())
		return
	}
	response.JSON(w, http.StatusOK, g)
}
