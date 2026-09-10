package qrpayment

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/kiramopay/backend/internal/middleware"
	"github.com/kiramopay/backend/pkg/response"
)

// responderError traduce los errores tipados del paquete a un codigo propio.
//
// Antes esta ruta respondia siempre PAYMENT_FAILED y el adaptador del frontend
// encima lo pisaba con otro generico, asi que el motivo real —"el cajero cambio
// el monto", "ese cobro ya lo pagaron", "el codigo fue retirado"— no llegaba
// nunca a la pantalla. 409 para los de estado, 400 para los de forma.
func responderError(w http.ResponseWriter, err error) {
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
		{ErrNonceInvalido, "LLAVE_INVALIDA", http.StatusBadRequest, "idempotency_key invalida"},
		{ErrCobroDuplicadoAppVieja, "COBRO_DUPLICADO_APP_VIEJA", http.StatusConflict,
			"actualiza la aplicacion para volver a pagar este codigo"},
		{ErrPagoNoRegistrado, "PAGO_NO_REGISTRADO", http.StatusConflict, "el pago no quedo registrado"},
	}
	for _, c := range casos {
		if errors.Is(err, c.err) {
			response.Error(w, c.http, c.codigo, c.msg)
			return
		}
	}
	response.Error(w, http.StatusBadRequest, "PAYMENT_FAILED", err.Error())
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
		responderError(w, err)
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
