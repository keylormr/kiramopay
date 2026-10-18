package payment

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/kiramopay/backend/internal/ledger"
	"github.com/kiramopay/backend/internal/middleware"
	"github.com/kiramopay/backend/internal/transaction"
	"github.com/kiramopay/backend/pkg/response"
)

type Handler struct {
	service *Service
}

// responderRechazo responde el error de pagar un recibo o recargar con su
// codigo propio, el mismo que usan SINPE y el pago por QR para el mismo motivo.
//
// Antes todo lo que no era SIN_CONVENIO ni MFA_REQUIRED salia 400 con el error
// tal cual ("process payment: insufficient balance"), y la pantalla, que ya no
// pinta el texto del servidor, no podia decir por que no se pago. Lo que no se
// reconoce es un 500 con el codigo de siempre (`generico`): es un fallo del
// servidor, y el pago pudo haber salido (un commit que se corta termina aqui).
// La pantalla lo dice como un pago sin confirmar y conserva la llave, asi que
// reintentar no cobra dos veces. El detalle queda en el log: response.Error no
// lo deja salir en un 5xx.
func responderRechazo(w http.ResponseWriter, err error, generico string) {
	type caso struct {
		err    error
		http   int
		codigo string
		msg    string
	}
	casos := []caso{
		// Sin convenio con la empresa o el operador: no es un fallo del usuario
		// ni de su saldo, y no se cobro nada.
		{ErrSinConvenio, http.StatusServiceUnavailable, "SIN_CONVENIO", "el pago no se puede entregar todavia"},
		// El gate de MFA vive en el motor de transferencias. Se verifica el
		// codigo y se reintenta el mismo pedido, con la misma llave.
		{transaction.ErrMFARequired, http.StatusPreconditionRequired, "MFA_REQUIRED",
			"verified MFA challenge required for this amount"},
		// El saldo: el de la comprobacion previa y el del asiento, que es el que
		// frena bajo concurrencia.
		{transaction.ErrSaldoInsuficiente, http.StatusUnprocessableEntity, "INSUFFICIENT_BALANCE",
			transaction.ErrSaldoInsuficiente.Error()},
		{ledger.ErrInsufficientFunds, http.StatusUnprocessableEntity, "INSUFFICIENT_BALANCE",
			transaction.ErrSaldoInsuficiente.Error()},
		{transaction.ErrDailyLimitExceeded, http.StatusUnprocessableEntity, "DAILY_LIMIT_EXCEEDED",
			transaction.ErrDailyLimitExceeded.Error()},
		{transaction.ErrMonthlyLimitExceeded, http.StatusUnprocessableEntity, "MONTHLY_LIMIT_EXCEEDED",
			transaction.ErrMonthlyLimitExceeded.Error()},
		{transaction.ErrBloqueadoPorRiesgo, http.StatusBadRequest, "TRANSFER_BLOCKED",
			transaction.ErrBloqueadoPorRiesgo.Error()},
		// La llave ya es de otro pago: otro cliente, otro telefono u otro
		// monto. Nada se movio; el pago nuevo necesita otra llave.
		{transaction.ErrLlaveReutilizada, http.StatusConflict, "LLAVE_REUTILIZADA",
			"idempotency key reused for a different payment"},
		{transaction.ErrLlaveDeOtroMovimiento, http.StatusConflict, "LLAVE_REUTILIZADA",
			"idempotency key reused for a different payment"},
		{ErrLlaveInvalida, http.StatusBadRequest, "LLAVE_INVALIDA", ErrLlaveInvalida.Error()},
		{ErrProveedorInvalido, http.StatusBadRequest, "INVALID_PROVIDER", ErrProveedorInvalido.Error()},
		{ErrOperadorInvalido, http.StatusBadRequest, "INVALID_OPERATOR", ErrOperadorInvalido.Error()},
	}
	for _, c := range casos {
		if errors.Is(err, c.err) {
			response.Error(w, c.http, c.codigo, c.msg)
			return
		}
	}
	response.Error(w, http.StatusInternalServerError, generico, err.Error())
}

func NewHandler(service *Service) *Handler {
	return &Handler{service: service}
}

func (h *Handler) PayBill(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		response.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "user not authenticated")
		return
	}

	var req PayBillRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.Error(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}

	if req.ProviderCode == "" || req.ClientID == "" || req.Amount <= 0 {
		response.Error(w, http.StatusBadRequest, "VALIDATION_ERROR", "provider_code, client_id, and amount are required")
		return
	}

	result, err := h.service.PayBill(r.Context(), userID, &req)
	if err != nil {
		responderRechazo(w, err, "PAYMENT_FAILED")
		return
	}

	response.JSON(w, http.StatusOK, result)
}

func (h *Handler) Recharge(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		response.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "user not authenticated")
		return
	}

	var req RechargeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.Error(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}

	if req.Operator == "" || req.Phone == "" || req.Amount <= 0 {
		response.Error(w, http.StatusBadRequest, "VALIDATION_ERROR", "operator, phone, and amount are required")
		return
	}

	result, err := h.service.Recharge(r.Context(), userID, &req)
	if err != nil {
		responderRechazo(w, err, "RECHARGE_FAILED")
		return
	}

	response.JSON(w, http.StatusOK, result)
}

func (h *Handler) GetSavedServices(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		response.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "user not authenticated")
		return
	}

	services, err := h.service.GetSavedServices(r.Context(), userID)
	if err != nil {
		response.Error(w, http.StatusInternalServerError, "FETCH_FAILED", err.Error())
		return
	}

	response.JSON(w, http.StatusOK, services)
}

func (h *Handler) AddSavedService(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		response.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "user not authenticated")
		return
	}

	var req struct {
		ProviderCode string `json:"provider_code"`
		ClientID     string `json:"client_id"`
		Nickname     string `json:"nickname"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.Error(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}

	service, err := h.service.AddSavedService(r.Context(), userID, req.ProviderCode, req.ClientID, req.Nickname)
	if err != nil {
		response.Error(w, http.StatusBadRequest, "ADD_FAILED", err.Error())
		return
	}

	response.JSON(w, http.StatusCreated, service)
}

func (h *Handler) GetPaymentHistory(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		response.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "user not authenticated")
		return
	}

	history, err := h.service.GetPaymentHistory(r.Context(), userID)
	if err != nil {
		response.Error(w, http.StatusInternalServerError, "FETCH_FAILED", err.Error())
		return
	}

	response.JSON(w, http.StatusOK, history)
}
