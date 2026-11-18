package qrpayment

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/kiramopay/backend/internal/lightning"
	"github.com/kiramopay/backend/internal/middleware"
	"github.com/kiramopay/backend/pkg/response"
)

// Rutas del cobro con Lightning en la billetera propia del comercio. Ver
// lightning.go.

// GetPaymentMethods — GET /api/v1/qr/merchants/{id}/payment-methods.
// Cualquiera del equipo: el cajero necesita saber si ofrece Lightning y que
// numero de SINPE decir.
func (h *Handler) GetPaymentMethods(w http.ResponseWriter, r *http.Request) {
	merchantID, ok := idDeComercioDeLaRuta(w, r)
	if !ok {
		return
	}
	medios, err := h.service.MediosDelComercio(r.Context(), middleware.GetUserID(r.Context()), merchantID)
	if err != nil {
		responderErrorLightning(w, "PAYMENT_METHODS_FAILED", err, false)
		return
	}
	response.JSON(w, http.StatusOK, medios)
}

// PutPaymentMethods — PUT /api/v1/qr/merchants/{id}/payment-methods. Solo el
// dueno. {"lightning_address": "...", "sinpe_movil": "..."}; un campo ausente
// queda igual y uno vacio se quita.
func (h *Handler) PutPaymentMethods(w http.ResponseWriter, r *http.Request) {
	merchantID, ok := idDeComercioDeLaRuta(w, r)
	if !ok {
		return
	}
	var req GuardarMediosRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.Error(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}
	medios, err := h.service.GuardarMediosDeCobro(r.Context(), middleware.GetUserID(r.Context()), merchantID, &req)
	if err != nil {
		responderErrorLightning(w, "PAYMENT_METHODS_FAILED", err, true)
		return
	}
	response.JSON(w, http.StatusOK, medios)
}

// CreateChargeLightning — POST /api/v1/qr/charges/{id}/lightning. La factura
// Lightning del cobro: la vigente si la hay, si no una nueva.
func (h *Handler) CreateChargeLightning(w http.ResponseWriter, r *http.Request) {
	f, err := h.service.CrearFacturaLightning(r.Context(), middleware.GetUserID(r.Context()), chi.URLParam(r, "id"))
	if err != nil {
		responderErrorLightning(w, "LIGHTNING_FAILED", err, false)
		return
	}
	response.JSON(w, http.StatusOK, f)
}

// GetLightningSales — GET /api/v1/qr/merchants/{id}/lightning-sales?month=AAAA-MM&tz=360.
// Los cobros pagados por Lightning en ese mes, para el resumen del contador.
func (h *Handler) GetLightningSales(w http.ResponseWriter, r *http.Request) {
	merchantID, ok := idDeComercioDeLaRuta(w, r)
	if !ok {
		return
	}
	tz, _ := strconv.Atoi(r.URL.Query().Get("tz"))
	ventas, err := h.service.VentasLightningDelMes(r.Context(), middleware.GetUserID(r.Context()), merchantID,
		r.URL.Query().Get("month"), tz)
	if err != nil {
		responderErrorLightning(w, "LIGHTNING_SALES_FAILED", err, false)
		return
	}
	response.JSON(w, http.StatusOK, ventas)
}

func idDeComercioDeLaRuta(w http.ResponseWriter, r *http.Request) (string, bool) {
	id := chi.URLParam(r, "id")
	if _, err := uuid.Parse(id); err != nil {
		response.Error(w, http.StatusNotFound, "MERCHANT_NOT_FOUND", ErrComercioNoEncontrado.Error())
		return "", false
	}
	return id, true
}

// responderErrorLightning da su codigo a cada rechazo. alGuardar distingue la
// direccion que escribio el dueno (un 422 que puede corregir) de la que ya
// estaba guardada y falla al cobrar (el proveedor, un 502).
func responderErrorLightning(w http.ResponseWriter, generico string, err error, alGuardar bool) {
	if responderSiCerro(w, err) {
		return
	}
	direccion := http.StatusBadGateway
	codigoDireccion := "LIGHTNING_PROVIDER_FAILED"
	if alGuardar {
		direccion, codigoDireccion = http.StatusUnprocessableEntity, "LIGHTNING_ADDRESS_INVALID"
	}
	casos := []struct {
		err    error
		http   int
		codigo string
	}{
		{ErrComercioNoEncontrado, http.StatusNotFound, "MERCHANT_NOT_FOUND"},
		{ErrLightningNoDisponible, http.StatusServiceUnavailable, "LIGHTNING_UNAVAILABLE"},
		{ErrLightningSinDireccion, http.StatusConflict, "LIGHTNING_NO_ADDRESS"},
		{ErrSinpeMovilInvalido, http.StatusBadRequest, "SINPE_MOVIL_INVALID"},
		{ErrMesInvalido, http.StatusBadRequest, "INVALID_MONTH"},
		{ErrPrecioLightningViejo, http.StatusServiceUnavailable, "PRICE_STALE"},
		{ErrPrecioLightning, http.StatusServiceUnavailable, "PRICE_UNAVAILABLE"},
		{lightning.ErrDireccionInvalida, direccion, codigoDireccion},
		{lightning.ErrDominioNoPermitido, direccion, codigoDireccion},
		{lightning.ErrFueraDeRango, http.StatusUnprocessableEntity, "LIGHTNING_AMOUNT_OUT_OF_RANGE"},
		{lightning.ErrSinVerificacion, http.StatusBadGateway, "LIGHTNING_PROVIDER_FAILED"},
		{lightning.ErrFacturaNoCorresponde, http.StatusBadGateway, "LIGHTNING_PROVIDER_FAILED"},
		{lightning.ErrProveedor, direccion, codigoDireccion},
	}
	for _, c := range casos {
		if errors.Is(err, c.err) {
			response.Error(w, c.http, c.codigo, c.err.Error())
			return
		}
	}
	if responderConocido(w, err) {
		return
	}
	response.Error(w, http.StatusInternalServerError, generico, err.Error())
}
