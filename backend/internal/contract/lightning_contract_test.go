package contract_test

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/shopspring/decimal"

	"github.com/kiramopay/backend/internal/contract"
	"github.com/kiramopay/backend/internal/qrpayment"
	"github.com/kiramopay/backend/pkg/response"
)

// Contrato del cobro con Lightning: la factura de un cobro, el cobro con su
// factura, los medios de cobro del comercio y las ventas para el contador.

func facturaDePrueba(estado string, pagada *time.Time) *qrpayment.CobroLightning {
	ahora := time.Date(2026, 11, 18, 15, 0, 0, 0, time.UTC)
	return &qrpayment.CobroLightning{
		ID: unUUID, ChargeID: otroUUID, Invoice: "lnbc125u1p...", PaymentHash: "00",
		Sats: 12_500, FiatAmount: 500_000, Currency: "CRC", BTCPrice: decimal.NewFromInt(40_000_000),
		QuoteExpiresAt: ahora.Add(10 * time.Minute), InvoiceExpiresAt: ahora.Add(time.Hour),
		Status: estado, PaidAt: pagada, CreatedAt: ahora,
	}
}

func TestLightning_LaFacturaYElCobroEstanEnElContrato(t *testing.T) {
	router := routerDeLaSpec(t)
	if err := contract.ValidateData(router, http.MethodPost, base+"/api/v1/qr/charges/"+otroUUID+"/lightning",
		http.StatusOK, comoJSON(t, facturaDePrueba("pending", nil))); err != nil {
		t.Errorf("la factura viola el esquema: %v", err)
	}

	pagada := time.Date(2026, 11, 18, 15, 3, 0, 0, time.UTC)
	cobro := qrpayment.QRCharge{
		ID: otroUUID, QRCodeID: unUUID, MerchantID: merchUUID, CreatedBy: unUUID, Amount: 500_000,
		Currency: "CRC", Channel: "counter", Status: "paid", QRData: "KP:merchant_fixed:x",
		ExpiresAt: pagada.Add(30 * time.Minute), PaidAt: &pagada, CreatedAt: pagada.Add(-time.Minute),
		PaidVia: qrpayment.PagadoPorLightning, Lightning: facturaDePrueba("paid", &pagada),
	}
	if err := contract.ValidateData(router, http.MethodGet, base+"/api/v1/qr/charges/"+otroUUID,
		http.StatusOK, comoJSON(t, cobro)); err != nil {
		t.Errorf("el cobro pagado por Lightning viola el esquema: %v", err)
	}
	// Un cobro de siempre, sin Lightning, tambien.
	cobro.PaidVia, cobro.Lightning = "", nil
	if err := contract.ValidateData(router, http.MethodGet, base+"/api/v1/qr/charges/"+otroUUID,
		http.StatusOK, comoJSON(t, cobro)); err != nil {
		t.Errorf("el cobro de siempre viola el esquema: %v", err)
	}
}

func TestLightning_LosMediosYLasVentasEstanEnElContrato(t *testing.T) {
	router := routerDeLaSpec(t)
	m := base + "/api/v1/qr/merchants/" + merchUUID
	medios := qrpayment.MediosDeCobro{LightningEnabled: true, LightningAddress: "soda@breez.tips", SinpeMovil: "88887777", CanEdit: true}
	for _, metodo := range []string{http.MethodGet, http.MethodPut} {
		if err := contract.ValidateData(router, metodo, m+"/payment-methods", http.StatusOK, comoJSON(t, medios)); err != nil {
			t.Errorf("%s payment-methods viola el esquema: %v", metodo, err)
		}
	}
	ventas := []qrpayment.VentaLightning{{
		ChargeID: otroUUID, Note: "Casado", FiatAmount: 500_000, Currency: "CRC", Sats: 12_500,
		BTCPrice: decimal.NewFromInt(40_000_000), PaymentHash: "00", PaidAt: time.Now().UTC(), ChargeStatus: "paid",
	}}
	if err := contract.ValidateData(router, http.MethodGet, m+"/lightning-sales?month=2026-11&tz=360", http.StatusOK,
		comoJSON(t, ventas)); err != nil {
		t.Errorf("lightning-sales viola el esquema: %v", err)
	}
}

// Cada rechazo con un estado que la ruta documenta. kin-openapi deja pasar un
// estado no documentado salvo con la validacion estricta; ValidateResponseBody
// la usa (ver revision-adversarial: una tabla que no podia fallar).
func TestLightning_LosRechazosEstanEnElContrato(t *testing.T) {
	router := routerDeLaSpec(t)
	m := base + "/api/v1/qr/merchants/" + merchUUID
	casos := []struct {
		metodo, url string
		http        int
		codigo      string
	}{
		{http.MethodPost, base + "/api/v1/qr/charges/" + otroUUID + "/lightning", http.StatusServiceUnavailable, "LIGHTNING_UNAVAILABLE"},
		{http.MethodPost, base + "/api/v1/qr/charges/" + otroUUID + "/lightning", http.StatusConflict, "LIGHTNING_NO_ADDRESS"},
		{http.MethodPost, base + "/api/v1/qr/charges/" + otroUUID + "/lightning", http.StatusBadGateway, "LIGHTNING_PROVIDER_FAILED"},
		{http.MethodPost, base + "/api/v1/qr/charges/" + otroUUID + "/lightning", http.StatusUnprocessableEntity, "LIGHTNING_AMOUNT_OUT_OF_RANGE"},
		{http.MethodPost, base + "/api/v1/qr/charges/" + otroUUID + "/lightning", http.StatusBadRequest, "QR_INVALIDO"},
		{http.MethodPost, base + "/api/v1/qr/charges/" + otroUUID + "/lightning", http.StatusInternalServerError, "LIGHTNING_FAILED"},
		{http.MethodPut, m + "/payment-methods", http.StatusUnprocessableEntity, "LIGHTNING_ADDRESS_INVALID"},
		{http.MethodPut, m + "/payment-methods", http.StatusBadRequest, "SINPE_MOVIL_INVALID"},
		{http.MethodPut, m + "/payment-methods", http.StatusServiceUnavailable, "LIGHTNING_UNAVAILABLE"},
		{http.MethodPut, m + "/payment-methods", http.StatusNotFound, "MERCHANT_NOT_FOUND"},
		{http.MethodGet, m + "/payment-methods", http.StatusConflict, "MERCHANT_CLOSED"},
		{http.MethodGet, m + "/lightning-sales?month=2026", http.StatusBadRequest, "INVALID_MONTH"},
	}
	for _, c := range casos {
		rec := httptest.NewRecorder()
		response.Error(rec, c.http, c.codigo, "x")
		if err := contract.ValidateResponseBody(router, c.metodo, c.url, c.http, rec.Body.Bytes()); err != nil {
			t.Errorf("%s %s (%d %s) viola el esquema: %v", c.metodo, c.url, c.http, c.codigo, err)
		}
	}
}
