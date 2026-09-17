package recurring

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
		escribirError(w, err, "CREATE_FAILED")
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
		escribirError(w, err, "UPDATE_FAILED")
		return
	}
	response.JSON(w, http.StatusOK, map[string]bool{"updated": true})
}

func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	paymentID := chi.URLParam(r, "id")

	if err := h.service.Delete(r.Context(), paymentID, userID); err != nil {
		escribirError(w, err, "DELETE_FAILED")
		return
	}
	response.NoContent(w)
}

func (h *Handler) Toggle(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	paymentID := chi.URLParam(r, "id")

	enabled, err := h.service.Toggle(r.Context(), paymentID, userID)
	if err != nil {
		escribirError(w, err, "TOGGLE_FAILED")
		return
	}
	response.JSON(w, http.StatusOK, map[string]bool{"enabled": enabled})
}

// MarkPaid anota el pago y corre la proxima fecha. No mueve dinero.
func (h *Handler) MarkPaid(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	paymentID := chi.URLParam(r, "id")

	payment, err := h.service.MarkPaid(r.Context(), paymentID, userID)
	if err != nil {
		escribirError(w, err, "MARK_PAID_FAILED")
		return
	}
	response.JSON(w, http.StatusOK, payment)
}

// escribirError da a cada rechazo su codigo; lo demas es una falla del
// servidor y sale como 5xx con el codigo de la operacion, sin el texto del
// driver (response.Error lo reemplaza en los 5xx).
func escribirError(w http.ResponseWriter, err error, codigoDeFalla string) {
	switch {
	case errors.Is(err, ErrNoEncontrado):
		response.Error(w, http.StatusNotFound, "RECURRING_NOT_FOUND", "recurring payment not found")
	case errors.Is(err, ErrNombreRequerido):
		response.Error(w, http.StatusBadRequest, "RECURRING_LABEL_REQUIRED", "the payment needs a label")
	case errors.Is(err, ErrNombreMuyLargo):
		response.Error(w, http.StatusBadRequest, "RECURRING_LABEL_TOO_LONG", "the label can have up to 200 characters")
	case errors.Is(err, ErrMontoInvalido):
		response.Error(w, http.StatusBadRequest, "RECURRING_INVALID_AMOUNT", "amount must be greater than zero")
	case errors.Is(err, ErrTipoInvalido):
		response.Error(w, http.StatusBadRequest, "RECURRING_INVALID_TYPE", "type must be service, sinpe or recharge")
	case errors.Is(err, ErrFrecuenciaInvalida):
		response.Error(w, http.StatusBadRequest, "RECURRING_INVALID_FREQUENCY", "frequency must be weekly, biweekly or monthly")
	case errors.Is(err, ErrFechaInvalida):
		response.Error(w, http.StatusBadRequest, "RECURRING_INVALID_DATE", "next_date must be a YYYY-MM-DD date")
	case errors.Is(err, ErrCampoInvalido):
		response.Error(w, http.StatusBadRequest, "RECURRING_INVALID_FIELD",
			"currency must be CRC or USD; recipient_phone up to 15 characters, recipient_name up to 100, service_provider_id up to 20 and client_id up to 50")
	default:
		response.Error(w, http.StatusInternalServerError, codigoDeFalla, err.Error())
	}
}
