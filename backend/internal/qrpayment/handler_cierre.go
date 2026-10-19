package qrpayment

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/kiramopay/backend/internal/middleware"
	"github.com/kiramopay/backend/internal/user"
	"github.com/kiramopay/backend/pkg/response"
)

// ── El cierre del comercio ──────────────────────────────────────────────────

// CloseMerchant — POST /api/v1/qr/merchants/{id}/close {"password":"...","totp_code":"..."}
//
// El dueno cierra el suyo, confirmando con su contrasena (y el codigo del
// autenticador si lo tiene encendido). Responde el comercio cerrado.
func (h *Handler) CloseMerchant(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	merchantID := chi.URLParam(r, "id")
	var req CerrarComercioRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, 4<<10)).Decode(&req); err != nil {
		response.Error(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}
	// Un id sin forma de UUID es un comercio que no existe, como en el retiro.
	// El que si la tiene sigue en su forma canonica: uuid.Parse acepta
	// mayusculas y llaves, y el rastro tiene que poder buscarse por el UUID.
	id, err := uuid.Parse(merchantID)
	if err != nil {
		response.Error(w, http.StatusNotFound, "MERCHANT_NOT_FOUND", ErrComercioNoEncontrado.Error())
		return
	}
	ac := ActorContext{IPAddress: middleware.RequestIP(r), UserAgent: r.UserAgent()}
	m, err := h.service.CerrarMiComercio(r.Context(), id.String(), userID, &req, ac)
	if err != nil {
		responderErrorDelCierre(w, err)
		return
	}
	response.JSON(w, http.StatusOK, m)
}

// AdminCloseMerchant — POST /api/v1/admin/merchants/{id}/close {"reason":"..."} (admin)
//
// Un administrador cierra cualquier comercio, con un motivo que queda en la fila
// y en el rastro.
func (h *Handler) AdminCloseMerchant(w http.ResponseWriter, r *http.Request) {
	adminID := middleware.GetUserID(r.Context())
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		response.Error(w, http.StatusBadRequest, "INVALID_ID", "id must be a UUID")
		return
	}
	var req CerrarComercioAdminRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, 4<<10)).Decode(&req); err != nil {
		response.Error(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}
	ac := ActorContext{IPAddress: middleware.RequestIP(r), UserAgent: r.UserAgent()}
	m, err := h.service.CerrarComercioComoAdmin(r.Context(), id.String(), adminID, req.Reason, ac)
	if err != nil {
		responderErrorDelCierre(w, err)
		return
	}
	response.JSON(w, http.StatusOK, m)
}

// AdminListMerchants — GET /api/v1/admin/merchants?q=texto (admin)
//
// Todos los comercios, cerrados incluidos y con su estado. Es la vista donde un
// comercio cerrado se sigue viendo.
func (h *Handler) AdminListMerchants(w http.ResponseWriter, r *http.Request) {
	merchants, err := h.service.ListarComercios(r.Context(), r.URL.Query().Get("q"))
	if err != nil {
		response.Error(w, http.StatusInternalServerError, "FETCH_FAILED", err.Error())
		return
	}
	if merchants == nil {
		merchants = []Merchant{}
	}
	response.JSON(w, http.StatusOK, merchants)
}

// responderErrorDelCierre da a cada rechazo del cierre su codigo. El saldo y los
// cobros pendientes llevan el detalle, para que la pantalla diga cuanto queda
// sin adivinar. Lo que la persona lee lo escribe la pantalla a partir del
// codigo; el mensaje es para quien integra la API.
func responderErrorDelCierre(w http.ResponseWriter, err error) {
	var conSaldo *ComercioConSaldoError
	var conCobros *ComercioConCobrosError
	switch {
	case errors.As(err, &conSaldo):
		response.ErrorConDetalle(w, http.StatusConflict, "MERCHANT_HAS_BALANCE",
			"the business balance must be withdrawn before closing",
			map[string]any{"balances": conSaldo.Saldos})
	case errors.As(err, &conCobros):
		response.ErrorConDetalle(w, http.StatusConflict, "MERCHANT_HAS_PENDING_CHARGES",
			"pending charges must be paid, cancelled or expired before closing",
			map[string]any{"pending_charges": conCobros.Pendientes})
	case errors.Is(err, ErrComercioCerrado):
		response.Error(w, http.StatusConflict, "MERCHANT_CLOSED", ErrComercioCerrado.Error())
	case errors.Is(err, ErrComercioNoEncontrado):
		response.Error(w, http.StatusNotFound, "MERCHANT_NOT_FOUND", ErrComercioNoEncontrado.Error())
	case errors.Is(err, ErrMotivoDeCierreRequerido):
		response.Error(w, http.StatusBadRequest, "CLOSURE_REASON_REQUIRED", "a reason is required to close a merchant")
	case errors.Is(err, ErrMotivoDeCierreMuyLargo):
		response.Error(w, http.StatusBadRequest, "CLOSURE_REASON_TOO_LONG", ErrMotivoDeCierreMuyLargo.Error())
	case errors.Is(err, ErrContrasenaIncorrecta):
		response.Error(w, http.StatusBadRequest, "CURRENT_PASSWORD_INVALID", ErrContrasenaIncorrecta.Error())
	case errors.Is(err, ErrTOTPRequerido):
		response.Error(w, http.StatusBadRequest, "TOTP_REQUIRED", ErrTOTPRequerido.Error())
	case errors.Is(err, ErrTOTPInvalido):
		response.Error(w, http.StatusBadRequest, "TOTP_INVALID", ErrTOTPInvalido.Error())
	case errors.Is(err, ErrCierreEnPausa):
		response.Error(w, http.StatusLocked, "MERCHANT_CLOSE_LOCKED", ErrCierreEnPausa.Error())
	case errors.Is(err, user.ErrCuentaDeDemostracion):
		response.Error(w, http.StatusForbidden, "DEMO_ACCOUNT", "a demo account cannot close a merchant")
	default:
		// La base, la transaccion: el detalle queda en el log.
		response.Error(w, http.StatusInternalServerError, "CLOSE_FAILED", err.Error())
	}
}
