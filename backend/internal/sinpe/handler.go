package sinpe

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/kiramopay/backend/internal/ledger"
	"github.com/kiramopay/backend/internal/middleware"
	"github.com/kiramopay/backend/internal/transaction"
	"github.com/kiramopay/backend/pkg/response"
	"github.com/kiramopay/backend/pkg/validator"
)

type Handler struct {
	service *Service
}

func NewHandler(service *Service) *Handler {
	return &Handler{service: service}
}

func (h *Handler) GetContacts(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		response.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "user not authenticated")
		return
	}

	contacts, err := h.service.GetContacts(r.Context(), userID)
	if err != nil {
		response.Error(w, http.StatusInternalServerError, "FETCH_FAILED", err.Error())
		return
	}

	response.JSON(w, http.StatusOK, contacts)
}

func (h *Handler) AddContact(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		response.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "user not authenticated")
		return
	}

	var req struct {
		Phone      string `json:"phone"`
		Name       string `json:"name"`
		Bank       string `json:"bank"`
		IsFavorite bool   `json:"is_favorite"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.Error(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}

	if err := validator.ValidatePhone(req.Phone); err != nil {
		response.Error(w, http.StatusBadRequest, "VALIDATION_ERROR", err.Message)
		return
	}
	if err := validator.ValidateRequired("name", req.Name); err != nil {
		response.Error(w, http.StatusBadRequest, "VALIDATION_ERROR", err.Message)
		return
	}

	contact, err := h.service.AddContact(r.Context(), userID, req.Phone, req.Name, req.Bank, req.IsFavorite)
	if err != nil {
		var exists *ContactExistsError
		if errors.As(err, &exists) {
			// El contacto NO se pisa: se devuelve tal como esta hoy, para que
			// el cliente pueda mostrarlo (nombre, banco) en vez de adivinar.
			response.ErrorWithData(w, http.StatusConflict, "CONTACT_EXISTS",
				"ya tienes este numero guardado como contacto", exists.Existing)
			return
		}
		response.Error(w, http.StatusBadRequest, "ADD_FAILED", err.Error())
		return
	}

	response.JSON(w, http.StatusCreated, contact)
}

func (h *Handler) GetHistory(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		response.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "user not authenticated")
		return
	}

	history, err := h.service.GetHistory(r.Context(), userID)
	if err != nil {
		response.Error(w, http.StatusInternalServerError, "FETCH_FAILED", err.Error())
		return
	}

	response.JSON(w, http.StatusOK, history)
}

// respuestaDelRechazo traduce el error del envio a la respuesta. Cada rechazo
// tiene su codigo, para que la pantalla lo diga en el idioma de la persona y
// explique que hacer. El texto es el del rechazo y no err.Error(): el error
// sube envuelto en prefijos internos ("create transaction: ...") y un 4xx sale
// tal cual, asi que la pantalla mostraba esa frase en ingles. Lo que no se
// reconoce es un 500: el detalle queda en el log (response.Error no lo deja
// salir).
func respuestaDelRechazo(err error) (int, string, string) {
	switch {
	case errors.Is(err, transaction.ErrMFARequired):
		return http.StatusPreconditionRequired, "MFA_REQUIRED",
			"MFA challenge required for amounts >= 100,000 CRC"
	case errors.Is(err, ErrRecipientNotUser):
		return http.StatusBadRequest, "RECIPIENT_NOT_USER", ErrRecipientNotUser.Error()
	case errors.Is(err, ErrSelfSend):
		return http.StatusBadRequest, "SELF_SEND", ErrSelfSend.Error()
	case errors.Is(err, ErrInvalidPhone):
		return http.StatusBadRequest, "INVALID_PHONE", ErrInvalidPhone.Error()
	// La llave ya es de otro envio: es lo unico que le dice a la pantalla que
	// esa llave no sirve y que el envio nuevo necesita otra. Con el
	// SINPE_FAILED generico no lo podia distinguir de un fallo que se arregla
	// reintentando con la misma. El asiento de otro movimiento bajo la llave es
	// el mismo caso visto desde el libro.
	case errors.Is(err, transaction.ErrLlaveReutilizada),
		errors.Is(err, transaction.ErrLlaveDeOtroMovimiento):
		return http.StatusConflict, "LLAVE_REUTILIZADA",
			"the idempotency_key belongs to a different transfer"
	// El saldo: el de la comprobacion previa y el del asiento, que es el que
	// frena bajo concurrencia.
	case errors.Is(err, transaction.ErrSaldoInsuficiente),
		errors.Is(err, ledger.ErrInsufficientFunds):
		return http.StatusUnprocessableEntity, "INSUFFICIENT_BALANCE",
			transaction.ErrSaldoInsuficiente.Error()
	case errors.Is(err, ErrMaximoPorEnvio):
		return http.StatusUnprocessableEntity, "SINGLE_PAYMENT_LIMIT_EXCEEDED", ErrMaximoPorEnvio.Error()
	case errors.Is(err, ErrCupoDiarioSinpe):
		return http.StatusUnprocessableEntity, "SINPE_DAILY_LIMIT_EXCEEDED", ErrCupoDiarioSinpe.Error()
	case errors.Is(err, transaction.ErrDailyLimitExceeded):
		return http.StatusUnprocessableEntity, "DAILY_LIMIT_EXCEEDED",
			transaction.ErrDailyLimitExceeded.Error()
	case errors.Is(err, transaction.ErrMonthlyLimitExceeded):
		return http.StatusUnprocessableEntity, "MONTHLY_LIMIT_EXCEEDED",
			transaction.ErrMonthlyLimitExceeded.Error()
	// Con codigo propio: SINPE_FAILED queda solo para el 500, y la pantalla
	// no puede decirle "no se pudo, intenta de nuevo" a un envio que pudo
	// haber salido ni "no pudimos confirmar" a uno que se rechazo.
	case errors.Is(err, transaction.ErrBloqueadoPorRiesgo):
		return http.StatusBadRequest, "TRANSFER_BLOCKED", transaction.ErrBloqueadoPorRiesgo.Error()
	}
	// ErrBuscarDestino —la base fallo al buscar a quien recibe— y cualquier
	// otro: nada que corregir en el pedido. Un commit que se corta tambien
	// cae aqui, asi que el envio pudo haber salido: la pantalla lo dice como
	// algo sin confirmar.
	return http.StatusInternalServerError, "SINPE_FAILED", err.Error()
}

func (h *Handler) Send(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		response.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "user not authenticated")
		return
	}

	var req SendRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.Error(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}

	if err := validator.ValidatePhone(req.Phone); err != nil {
		response.Error(w, http.StatusBadRequest, "VALIDATION_ERROR", err.Message)
		return
	}
	if req.Amount <= 0 {
		response.Error(w, http.StatusBadRequest, "VALIDATION_ERROR", "amount must be positive")
		return
	}

	// Validada: termina en la auditoria, que la castea a inet.
	ip := middleware.RequestIP(r)

	result, err := h.service.Send(r.Context(), userID, &req, ip)
	if err != nil {
		estado, codigo, mensaje := respuestaDelRechazo(err)
		response.Error(w, estado, codigo, mensaje)
		return
	}

	response.JSON(w, http.StatusOK, result)
}
