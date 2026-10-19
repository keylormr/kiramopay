package contract_test

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/kiramopay/backend/internal/contract"
	"github.com/kiramopay/backend/internal/qrpayment"
	"github.com/kiramopay/backend/pkg/response"
)

// Contrato del cierre de comercios (PR 292).

// Cada ruta que un comercio cerrado rechaza documenta su 409 MERCHANT_CLOSED,
// con el sobre de error. Mismo criterio que TestCryptoErrores_CumplenElContrato:
// la tabla prueba que el spec documenta el estado en esa ruta.
func TestComercioCerrado_LosRechazosEstanEnElContrato(t *testing.T) {
	router := routerDeLaSpec(t)
	m := "/api/v1/qr/merchants/" + merchUUID
	a := "/api/v1/admin/merchants/" + merchUUID
	casos := []struct{ metodo, ruta string }{
		{http.MethodPatch, m},
		{http.MethodPost, m + "/close"},
		{http.MethodPost, m + "/withdraw"},
		{http.MethodGet, m + "/code"},
		{http.MethodGet, m + "/staff"},
		{http.MethodPost, m + "/staff"},
		{http.MethodPut, m + "/staff/" + unUUID},
		{http.MethodDelete, m + "/staff/" + unUUID},
		{http.MethodGet, m + "/locations"},
		{http.MethodPost, m + "/locations"},
		{http.MethodPut, m + "/locations/" + unUUID},
		{http.MethodGet, m + "/catalog"},
		{http.MethodPost, m + "/catalog"},
		{http.MethodPut, m + "/catalog/" + unUUID},
		{http.MethodDelete, m + "/catalog/" + unUUID},
		{http.MethodPost, "/api/v1/qr/codes"},
		{http.MethodPost, "/api/v1/qr/charges"},
		{http.MethodPost, "/api/v1/qr/resolve"},
		{http.MethodPost, "/api/v1/qr/pay"},
		{http.MethodPost, a + "/approve"},
		{http.MethodPost, a + "/reject"},
		{http.MethodPatch, a + "/commission"},
		{http.MethodPatch, a + "/plan"},
		{http.MethodPost, a + "/close"},
	}
	for _, c := range casos {
		t.Run(c.metodo+" "+c.ruta, func(t *testing.T) {
			rec := httptest.NewRecorder()
			response.Error(rec, http.StatusConflict, "MERCHANT_CLOSED", "this merchant was closed")
			if err := contract.ValidateResponseBody(router, c.metodo, base+c.ruta, http.StatusConflict, rec.Body.Bytes()); err != nil {
				t.Errorf("%s %s (409 MERCHANT_CLOSED) viola el esquema: %v", c.metodo, c.ruta, err)
			}
		})
	}
}

// Lo que el dueno sigue leyendo de un comercio cerrado, con los mismos tipos que
// escriben los handlers, y las listas de gestion que la pantalla del comercio
// abierto ya leia sin contrato.
func TestComercioCerrado_LoQueSeLeeEstaEnElContrato(t *testing.T) {
	router := routerDeLaSpec(t)
	ahora := time.Date(2026, 10, 19, 15, 0, 0, 0, time.UTC)
	m := "/api/v1/qr/merchants/" + merchUUID

	cerrado := qrpayment.Merchant{
		ID: merchUUID, UserID: unUUID, Name: "Soda Tica", Category: "restaurant",
		Cedula: "3-101-123", CedulaType: "juridica", LegalName: "Soda Tica SA",
		VerificationStatus: "verified", CommissionBps: 50, ComisionEfectivaBps: 50,
		Plan: qrpayment.PlanComercioBase, CreatedAt: ahora, Role: qrpayment.RoleOwner,
		ClosedAt: &ahora, ClosedBy: unUUID, ClosureReason: qrpayment.MotivoCierrePropio,
	}
	if err := contract.ValidateData(router, http.MethodGet, base+"/api/v1/qr/merchants?status=closed", http.StatusOK,
		comoJSON(t, []qrpayment.Merchant{cerrado})); err != nil {
		t.Errorf("lista de comercios cerrados viola el esquema: %v", err)
	}
	ruta, _, err := router.FindRoute(httptest.NewRequest(http.MethodGet, base+"/api/v1/qr/merchants", nil))
	if err != nil {
		t.Fatalf("GET /api/v1/qr/merchants no esta en el spec: %v", err)
	}
	estado := ruta.Operation.Parameters.GetByInAndName("query", "status")
	if estado == nil || estado.Schema == nil || estado.Schema.Value == nil || len(estado.Schema.Value.Enum) != 2 {
		t.Errorf("GET /api/v1/qr/merchants no documenta el parametro status (open, closed): %+v", estado)
	}

	if err := contract.ValidateData(router, http.MethodGet, base+m+"/balance", http.StatusOK,
		comoJSON(t, map[string]any{"balance": int64(0), "currency": "CRC"})); err != nil {
		t.Errorf("saldo del comercio viola el esquema: %v", err)
	}
	venta := qrpayment.QRPaymentRecord{
		ID: unUUID, QRCodeID: otroUUID, ChargeID: otroUUID, PayerID: unUUID, ReceiverID: otroUUID,
		MerchantID: merchUUID, LocationID: otroUUID, CollectedBy: otroUUID, Amount: 100000, Fee: 500,
		Currency: "CRC", Status: "completed", Note: "almuerzo", TxID: unUUID, CreatedAt: ahora, CompletedAt: &ahora,
	}
	if err := contract.ValidateData(router, http.MethodGet, base+m+"/payments", http.StatusOK,
		comoJSON(t, []qrpayment.QRPaymentRecord{venta})); err != nil {
		t.Errorf("ventas del comercio violan el esquema: %v", err)
	}

	miembro := qrpayment.StaffMember{
		ID: unUUID, MerchantID: merchUUID, UserID: otroUUID, FirstName: "Ana", LastName: "Mora",
		Role: qrpayment.RoleCashier, Status: "revoked", LocationID: otroUUID, CreatedAt: ahora, RevokedAt: &ahora,
	}
	if err := contract.ValidateData(router, http.MethodGet, base+m+"/staff", http.StatusOK,
		comoJSON(t, []qrpayment.StaffMember{miembro})); err != nil {
		t.Errorf("equipo del comercio viola el esquema: %v", err)
	}
	sucursal := qrpayment.Location{ID: otroUUID, MerchantID: merchUUID, Name: "Centro", Address: "Calle 1", Active: true, CreatedAt: ahora}
	if err := contract.ValidateData(router, http.MethodGet, base+m+"/locations", http.StatusOK,
		comoJSON(t, []qrpayment.Location{sucursal})); err != nil {
		t.Errorf("sucursales del comercio violan el esquema: %v", err)
	}
	articulo := qrpayment.CatalogItem{
		ID: unUUID, MerchantID: merchUUID, Name: "Cafe", PriceMinor: 100000, Currency: "CRC", Active: true, SortOrder: 1, CreatedAt: ahora,
	}
	if err := contract.ValidateData(router, http.MethodGet, base+m+"/catalog", http.StatusOK,
		comoJSON(t, []qrpayment.CatalogItem{articulo})); err != nil {
		t.Errorf("catalogo del comercio viola el esquema: %v", err)
	}
}

// Las ventas se leen por paginas (limit, before) y un cursor que no es un id es
// un 400 INVALID_CURSOR. Y el reporte y su CSV dicen que el de un comercio
// cerrado cuenta hasta el cierre y que su dueno lo exporta con cualquier plan:
// el spec decia "analitica plan" sin excepcion, y el handler responde 200.
func TestVentasYReporteDeUnCerrado_EstanEnElContrato(t *testing.T) {
	router := routerDeLaSpec(t)
	m := base + "/api/v1/qr/merchants/" + merchUUID

	ruta, _, err := router.FindRoute(httptest.NewRequest(http.MethodGet, m+"/payments", nil))
	if err != nil {
		t.Fatalf("GET /payments no esta en el spec: %v", err)
	}
	for _, nombre := range []string{"limit", "before"} {
		if ruta.Operation.Parameters.GetByInAndName("query", nombre) == nil {
			t.Errorf("GET /payments no documenta el parametro %s", nombre)
		}
	}
	rec := httptest.NewRecorder()
	response.Error(rec, http.StatusBadRequest, "INVALID_CURSOR", "before must be the id of a payment")
	if err := contract.ValidateResponseBody(router, http.MethodGet, m+"/payments", http.StatusBadRequest, rec.Body.Bytes()); err != nil {
		t.Errorf("GET /payments (400 INVALID_CURSOR) viola el esquema: %v", err)
	}

	for _, sufijo := range []string{"/report", "/report.csv"} {
		ruta, _, err := router.FindRoute(httptest.NewRequest(http.MethodGet, m+sufijo, nil))
		if err != nil {
			t.Fatalf("GET %s no esta en el spec: %v", sufijo, err)
		}
		if d := ruta.Operation.Description; !strings.Contains(d, "closed merchant") {
			t.Errorf("GET %s no dice como se lee el de un comercio cerrado: %q", sufijo, d)
		}
	}
}
