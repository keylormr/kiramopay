package qrpayment

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/kiramopay/backend/internal/ledger"
	"github.com/kiramopay/backend/internal/middleware"
	"github.com/kiramopay/backend/internal/transaction"
	"github.com/kiramopay/backend/pkg/response"
)

// responderError traduce los errores tipados del paquete a un codigo propio.
//
// Antes esta ruta respondia siempre PAYMENT_FAILED y el adaptador del frontend
// encima lo pisaba con otro generico, asi que el motivo real —"el cajero cambio
// el monto", "ese cobro ya lo pagaron", "el codigo fue retirado"— no llegaba
// nunca a la pantalla. 409 para los de estado, 400 para los de forma.
//
// Lo que no tiene codigo propio es un fallo del servidor: 500, con el detalle
// solo en el log (response.Error no lo deja salir). Salia 400 con el error tal
// cual, y la pantalla lo pintaba: crear un cobro que fallaba en la base le
// mostraba a la persona la frase del driver.
func responderError(w http.ResponseWriter, err error) {
	if responderConocido(w, err) {
		return
	}
	response.Error(w, http.StatusInternalServerError, "PAYMENT_FAILED", err.Error())
}

// responderErrorDelPago es responderError para POST /qr/pay, donde el 500 de lo
// que no se reconoce importa por otra razon: el pago pudo haber salido (un
// commit que se corta termina aqui), y la pantalla lo dice como un pago sin
// confirmar y conserva la llave, asi que reintentar no cobra dos veces. Como
// 400, la pantalla lo tomaba por un rechazo y soltaba la llave: el reintento
// era otro pago.
func responderErrorDelPago(w http.ResponseWriter, err error) {
	responderError(w, err)
}

// responderConocido responde el error si tiene codigo propio, y dice si lo hizo.
func responderConocido(w http.ResponseWriter, err error) bool {
	type caso struct {
		err    error
		codigo string
		http   int
		msg    string
	}
	casos := []caso{
		{ErrQRInvalido, "QR_INVALIDO", http.StatusBadRequest, "ese codigo no existe o ya no es valido"},
		{ErrQRRevocado, "QR_REVOCADO", http.StatusConflict, "ese codigo fue retirado por su dueno"},
		{ErrCobroReemplazado, "COBRO_REEMPLAZADO", http.StatusConflict, "el cobro cambio, volve a escanear"},
		{ErrCobroYaPagado, "COBRO_YA_PAGADO", http.StatusConflict, "ese cobro ya fue pagado"},
		{ErrCobroVencido, "COBRO_VENCIDO", http.StatusConflict, "ese cobro vencio"},
		{ErrCobroCancelado, "COBRO_CANCELADO", http.StatusConflict, "ese cobro fue cancelado"},
		{ErrNoPodesPagarte, "NO_PODES_PAGARTE", http.StatusBadRequest, "no podes pagarte a vos mismo"},
		{ErrMontoRequerido, "MONTO_REQUERIDO", http.StatusBadRequest, "indica cuanto queres pagar"},
		{ErrLlaveReutilizada, "LLAVE_REUTILIZADA", http.StatusConflict, "esa operacion ya se hizo con otro monto"},
		// El mismo caso detectado por el motor de transferencias, que compara
		// la llave antes que el modulo: caia al PAYMENT_FAILED generico.
		{transaction.ErrLlaveReutilizada, "LLAVE_REUTILIZADA", http.StatusConflict, "esa operacion ya se hizo con otro monto"},
		{ErrNonceInvalido, "LLAVE_INVALIDA", http.StatusBadRequest, "idempotency_key invalida"},
		{ErrCobroDuplicadoAppVieja, "COBRO_DUPLICADO_APP_VIEJA", http.StatusConflict,
			"actualiza la aplicacion para volver a pagar este codigo"},
		{ErrPagoNoRegistrado, "PAGO_NO_REGISTRADO", http.StatusConflict, "el pago no quedo registrado"},
		{ErrMontoInvalido, "MONTO_INVALIDO", http.StatusBadRequest, "el monto debe ser mayor que cero"},
		// El umbral del segundo factor lo aplica el motor de transferencias, que
		// comparten SINPE y QR. SINPE ya respondia 428 MFA_REQUIRED y la pantalla
		// abria la verificacion; QR caia al PAYMENT_FAILED de abajo con "qr
		// payment transfer: mfa challenge required", asi que un pago por encima
		// del umbral no se podia completar nunca. Mismo contrato que SINPE: se
		// verifica el codigo y se reintenta la misma peticion.
		{transaction.ErrMFARequired, "MFA_REQUIRED", http.StatusPreconditionRequired,
			"este monto necesita verificar el segundo factor"},
		// Los rechazos del motor de transferencias, con el codigo que SINPE ya
		// usa para el mismo motivo. Caian al PAYMENT_FAILED de abajo con el
		// error envuelto ("qr payment transfer: insufficient balance"), y la
		// pantalla lo mostraba en ingles. El saldo: el de la comprobacion previa
		// y el del asiento, que es el que frena bajo concurrencia.
		{transaction.ErrSaldoInsuficiente, "INSUFFICIENT_BALANCE", http.StatusUnprocessableEntity,
			transaction.ErrSaldoInsuficiente.Error()},
		{ledger.ErrInsufficientFunds, "INSUFFICIENT_BALANCE", http.StatusUnprocessableEntity,
			transaction.ErrSaldoInsuficiente.Error()},
		{transaction.ErrDailyLimitExceeded, "DAILY_LIMIT_EXCEEDED", http.StatusUnprocessableEntity,
			transaction.ErrDailyLimitExceeded.Error()},
		{transaction.ErrMonthlyLimitExceeded, "MONTHLY_LIMIT_EXCEEDED", http.StatusUnprocessableEntity,
			transaction.ErrMonthlyLimitExceeded.Error()},
		{transaction.ErrBloqueadoPorRiesgo, "TRANSFER_BLOCKED", http.StatusBadRequest,
			transaction.ErrBloqueadoPorRiesgo.Error()},
		// La llave que ya es de otro movimiento, vista desde el libro.
		{transaction.ErrLlaveDeOtroMovimiento, "LLAVE_REUTILIZADA", http.StatusConflict,
			"esa operacion ya se hizo con otro monto"},
		{ErrComercioNoEncontrado, "MERCHANT_NOT_FOUND", http.StatusNotFound, ErrComercioNoEncontrado.Error()},
		{ErrComercioNoDisponible, "MERCHANT_UNAVAILABLE", http.StatusConflict, ErrComercioNoDisponible.Error()},
		{ErrSucursalNoEncontrada, "LOCATION_NOT_FOUND", http.StatusNotFound, ErrSucursalNoEncontrada.Error()},
		{ErrMonedaNoSoportada, "UNSUPPORTED_CURRENCY", http.StatusBadRequest, ErrMonedaNoSoportada.Error()},
		// Pagar un codigo en una moneda sin tope, nacido antes de que se
		// validara la moneda. El motor se niega antes de mover nada; caia al 500
		// y la pantalla lo decia como un pago sin confirmar.
		{transaction.ErrMonedaSinTope, "UNSUPPORTED_CURRENCY", http.StatusUnprocessableEntity, ErrMonedaNoSoportada.Error()},
	}
	for _, c := range casos {
		if errors.Is(err, c.err) {
			response.Error(w, c.http, c.codigo, c.msg)
			return true
		}
	}
	return false
}

// responderErrorDeEquipo traduce los errores de administrar el equipo del
// comercio. `generico` es el codigo que ya usaba cada ruta, que se conserva
// para todo lo que no tiene codigo propio.
//
// Lo que la persona lee lo escribe la PANTALLA, a partir del codigo. El mensaje
// de aqui es para quien integra la API y va en ingles, como el resto del
// backend: este decia "esa cedula no tiene una cuenta de KiramoPay" en espanol
// fijo, la hoja del equipo lo pintaba tal cual (`res.error.message`) y salia en
// espanol en medio de una pantalla en ingles, en japones o en frances.
func responderErrorDeEquipo(w http.ResponseWriter, generico string, err error) {
	if errors.Is(err, ErrCedulaSinCuenta) {
		response.Error(w, http.StatusUnprocessableEntity, "STAFF_CEDULA_NOT_FOUND",
			"no KiramoPay account is registered with that cedula")
		return
	}
	response.Error(w, http.StatusBadRequest, generico, err.Error())
}

// ── Identidad permanente ────────────────────────────────────────────────────

func (h *Handler) GetMyCode(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	moneda := r.URL.Query().Get("currency")
	code, err := h.service.GetOrCreateMyCode(r.Context(), userID, moneda)
	if err != nil {
		responderError(w, err)
		return
	}
	response.JSON(w, http.StatusOK, code)
}

func (h *Handler) GetMerchantCode(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	merchantID := chi.URLParam(r, "id")
	q := r.URL.Query()
	code, err := h.service.GetOrCreateMerchantCode(
		r.Context(), userID, merchantID, q.Get("location_id"), q.Get("currency"))
	if err != nil {
		responderError(w, err)
		return
	}
	response.JSON(w, http.StatusOK, code)
}

func (h *Handler) RevokeCode(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if err := h.service.RevokeCode(r.Context(), userID, chi.URLParam(r, "id")); err != nil {
		responderError(w, err)
		return
	}
	response.NoContent(w)
}

// ── Resolucion ──────────────────────────────────────────────────────────────

func (h *Handler) ResolveQR(w http.ResponseWriter, r *http.Request) {
	var req ResolveQRRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.Error(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}
	res, err := h.service.ResolveQR(r.Context(), req.QRData)
	if err != nil {
		// Los rechazos del codigo salen con su codigo (QR_INVALIDO solo si no
		// existe). Lo demas es la base que no contesto: 500, con el detalle en
		// el log y no en la respuesta. Por responderError salia 400
		// PAYMENT_FAILED con el error tal cual.
		if !responderConocido(w, err) {
			response.Error(w, http.StatusInternalServerError, "RESOLVE_FAILED", err.Error())
		}
		return
	}
	response.JSON(w, http.StatusOK, res)
}

// ── Cobros ──────────────────────────────────────────────────────────────────

func (h *Handler) CreateCharge(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	var req CreateChargeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.Error(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}
	cobro, err := h.service.CreateCharge(r.Context(), userID, &req)
	if err != nil {
		responderError(w, err)
		return
	}
	response.JSON(w, http.StatusCreated, cobro)
}

func (h *Handler) GetChargeStatus(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	cobro, err := h.service.GetCharge(r.Context(), userID, chi.URLParam(r, "id"))
	if err != nil {
		responderError(w, err)
		return
	}
	response.JSON(w, http.StatusOK, cobro)
}

func (h *Handler) CancelCharge(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if err := h.service.CancelCharge(r.Context(), userID, chi.URLParam(r, "id")); err != nil {
		responderError(w, err)
		return
	}
	response.NoContent(w)
}

func (h *Handler) ListCharges(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	cobros, err := h.service.ListCharges(r.Context(), userID, r.URL.Query().Get("status"))
	if err != nil {
		responderError(w, err)
		return
	}
	if cobros == nil {
		cobros = []QRCharge{}
	}
	response.JSON(w, http.StatusOK, cobros)
}
