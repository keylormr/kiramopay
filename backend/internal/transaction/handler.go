package transaction

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"time"

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
	// Lista blanca: esta ruta solo sirve para que una persona mueva SU dinero
	// hacia afuera. Lo que entra al monedero lo origina el servicio que sabe por
	// que entra, nunca el cliente.
	if !IsUserInitiable(req.Type) {
		response.Error(w, http.StatusBadRequest, "TYPE_NOT_ALLOWED",
			"this transaction type cannot be created from this endpoint")
		return
	}

	tx, err := h.service.CreateTransaction(r.Context(), userID, &req)
	if err != nil {
		// El gate de MFA vive en transaction.CreateTransaction, asi que esta
		// ruta tambien puede devolverlo. Sin este mapeo el cliente recibia el
		// codigo generico y mostraba el mensaje en ingles del servidor, sin
		// ofrecer nunca el desafio: la operacion moria ahi.
		if errors.Is(err, ErrMFARequired) {
			response.Error(w, http.StatusPreconditionRequired, "MFA_REQUIRED",
				"verified MFA challenge required for this amount")
			return
		}
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

	// Date bounds are rejected when malformed rather than ignored: silently
	// dropping a bad filter would return the WHOLE history as if it matched.
	from, err := parseTimeParam(q.Get("from"))
	if err != nil {
		response.Error(w, http.StatusBadRequest, "VALIDATION_ERROR", "invalid 'from': use RFC3339 or YYYY-MM-DD")
		return
	}
	to, err := parseTimeParam(q.Get("to"))
	if err != nil {
		response.Error(w, http.StatusBadRequest, "VALIDATION_ERROR", "invalid 'to': use RFC3339 or YYYY-MM-DD")
		return
	}

	req := &ListTransactionsRequest{
		Limit:    limit,
		Offset:   offset,
		Type:     q.Get("type"),
		Status:   q.Get("status"),
		Currency: q.Get("currency"),
		From:     from,
		To:       to,
	}

	result, err := h.service.ListTransactions(r.Context(), userID, req)
	if err != nil {
		response.Error(w, http.StatusInternalServerError, "LIST_FAILED", err.Error())
		return
	}

	response.JSON(w, http.StatusOK, result)
}

// parseTimeParam accepts RFC3339 ("2026-08-01T00:00:00Z") or a bare date
// ("2026-08-01", interpreted as midnight UTC). Empty means "not set".
func parseTimeParam(s string) (time.Time, error) {
	if s == "" {
		return time.Time{}, nil
	}
	if ts, err := time.Parse(time.RFC3339, s); err == nil {
		return ts, nil
	}
	if ts, err := time.Parse("2006-01-02", s); err == nil {
		return ts, nil
	}
	return time.Time{}, fmt.Errorf("unparseable time %q", s)
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
