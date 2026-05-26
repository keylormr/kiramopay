package cards

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

func (h *Handler) CreateCard(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	var req CreateCardRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.Error(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}

	// TODO: Get cardholder name from user profile service
	card, err := h.service.CreateCard(r.Context(), userID, "Titular KiramoPay", &req)
	if err != nil {
		response.Error(w, http.StatusBadRequest, "CREATE_FAILED", err.Error())
		return
	}
	response.JSON(w, http.StatusCreated, card)
}

func (h *Handler) GetCards(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	cards, err := h.service.GetCards(r.Context(), userID)
	if err != nil {
		response.Error(w, http.StatusInternalServerError, "FETCH_FAILED", err.Error())
		return
	}
	response.JSON(w, http.StatusOK, cards)
}

func (h *Handler) GetCard(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	cardID := chi.URLParam(r, "id")

	card, err := h.service.GetCard(r.Context(), cardID, userID)
	if err != nil {
		response.Error(w, http.StatusNotFound, "NOT_FOUND", err.Error())
		return
	}
	response.JSON(w, http.StatusOK, card)
}

func (h *Handler) FreezeCard(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	cardID := chi.URLParam(r, "id")
	var req FreezeCardRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.Error(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}

	if err := h.service.FreezeCard(r.Context(), cardID, userID, req.Frozen); err != nil {
		response.Error(w, http.StatusBadRequest, "FREEZE_FAILED", err.Error())
		return
	}
	response.NoContent(w)
}

func (h *Handler) CancelCard(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	cardID := chi.URLParam(r, "id")

	if err := h.service.CancelCard(r.Context(), cardID, userID); err != nil {
		response.Error(w, http.StatusBadRequest, "CANCEL_FAILED", err.Error())
		return
	}
	response.NoContent(w)
}

func (h *Handler) UpdateLimits(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	cardID := chi.URLParam(r, "id")
	var req UpdateLimitsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.Error(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}

	if err := h.service.UpdateLimits(r.Context(), cardID, userID, &req); err != nil {
		response.Error(w, http.StatusBadRequest, "UPDATE_FAILED", err.Error())
		return
	}
	response.NoContent(w)
}

func (h *Handler) GetCardTransactions(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	cardID := chi.URLParam(r, "id")

	txs, err := h.service.GetCardTransactions(r.Context(), cardID, userID)
	if err != nil {
		response.Error(w, http.StatusBadRequest, "FETCH_FAILED", err.Error())
		return
	}
	response.JSON(w, http.StatusOK, txs)
}
