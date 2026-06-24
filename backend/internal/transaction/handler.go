package transaction

import (
	"encoding/json"
	"net/http"
	"strconv"

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

func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		response.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "user not authenticated")
		return
	}

	var req CreateTransactionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.Error(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}

	if req.Amount <= 0 {
		response.Error(w, http.StatusBadRequest, "VALIDATION_ERROR", "amount must be positive")
		return
	}
	if req.Type == "" {
		response.Error(w, http.StatusBadRequest, "VALIDATION_ERROR", "type is required")
		return
	}

	tx, err := h.service.CreateTransaction(r.Context(), userID, &req)
	if err != nil {
		response.Error(w, http.StatusBadRequest, "TRANSACTION_FAILED", err.Error())
		return
	}

	response.JSON(w, http.StatusCreated, tx)
}

func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		response.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "user not authenticated")
		return
	}

	q := r.URL.Query()
	limit, _ := strconv.Atoi(q.Get("limit"))
	offset, _ := strconv.Atoi(q.Get("offset"))

	req := &ListTransactionsRequest{
		Limit:  limit,
		Offset: offset,
		Type:   q.Get("type"),
		Status: q.Get("status"),
	}

	result, err := h.service.ListTransactions(r.Context(), userID, req)
	if err != nil {
		response.Error(w, http.StatusInternalServerError, "LIST_FAILED", err.Error())
		return
	}

	response.JSON(w, http.StatusOK, result)
}

func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		response.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "user not authenticated")
		return
	}

	txID := chi.URLParam(r, "id")
	if txID == "" {
		response.Error(w, http.StatusBadRequest, "MISSING_ID", "transaction ID required")
		return
	}

	tx, err := h.service.GetTransaction(r.Context(), txID)
	if err != nil {
		response.Error(w, http.StatusNotFound, "NOT_FOUND", "transaction not found")
		return
	}
	// Ownership check: never expose another user's transaction (IDOR).
	if tx.UserID != userID {
		response.Error(w, http.StatusNotFound, "NOT_FOUND", "transaction not found")
		return
	}

	response.JSON(w, http.StatusOK, tx)
}
