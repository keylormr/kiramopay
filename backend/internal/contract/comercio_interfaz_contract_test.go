package contract_test

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/kiramopay/backend/internal/contract"
	"github.com/kiramopay/backend/internal/qrpayment"
	"github.com/kiramopay/backend/pkg/response"
)

// Contrato de la interfaz del comercio: el detalle de cada cobro, los
// movimientos por periodo, los totales de cada dia, el resumen y los retiros.

func pct(v float64) *float64 { return &v }

func TestInterfazDelComercio_LasVentasTraenQuienPagoYDondeSeCobro(t *testing.T) {
	router := routerDeLaSpec(t)
	ahora := time.Date(2026, 10, 29, 15, 0, 0, 0, time.UTC)
	m := "/api/v1/qr/merchants/" + merchUUID

	venta := qrpayment.QRPaymentRecord{
		ID: unUUID, QRCodeID: otroUUID, ChargeID: otroUUID, PayerID: unUUID, ReceiverID: otroUUID,
		MerchantID: merchUUID, LocationID: otroUUID, CollectedBy: otroUUID, Amount: 100000, Fee: 500,
		Currency: "CRC", Status: "completed", TxID: unUUID, CreatedAt: ahora, CompletedAt: &ahora,
		PayerName: "Ana Mora", LocationName: "Sucursal Centro", CollectorName: "Luis Rojas",
	}
	if err := contract.ValidateData(router, http.MethodGet, base+m+"/payments", http.StatusOK,
		comoJSON(t, []qrpayment.QRPaymentRecord{venta})); err != nil {
		t.Errorf("ventas con nombres violan el esquema: %v", err)
	}

	ruta, _, err := router.FindRoute(httptest.NewRequest(http.MethodGet, base+m+"/payments", nil))
	if err != nil {
		t.Fatalf("GET /payments no esta en el spec: %v", err)
	}
	for _, nombre := range []string{"period", "tz", "limit", "before"} {
		if ruta.Operation.Parameters.GetByInAndName("query", nombre) == nil {
			t.Errorf("GET /payments no documenta el parametro %s", nombre)
		}
	}

	rec := httptest.NewRecorder()
	response.Error(rec, http.StatusBadRequest, "INVALID_PERIOD", "period must be today, week, month or prev_month")
	if err := contract.ValidateResponseBody(router, http.MethodGet, base+m+"/payments", http.StatusBadRequest, rec.Body.Bytes()); err != nil {
		t.Errorf("GET /payments (400 INVALID_PERIOD) viola el esquema: %v", err)
	}
}

func TestInterfazDelComercio_LosTotalesDeCadaDiaEstanEnElContrato(t *testing.T) {
	router := routerDeLaSpec(t)
	m := "/api/v1/qr/merchants/" + merchUUID

	dias := []qrpayment.TotalDelDia{
		{Date: "2026-10-29", Currency: "CRC", Gross: 100000, Fee: 500, Net: 99500, Count: 1},
		{Date: "2026-10-28", Currency: "USD", Gross: 10000, Fee: 50, Net: 9950, Count: 1},
	}
	if err := contract.ValidateData(router, http.MethodGet, base+m+"/payments/daily?period=month&tz=360", http.StatusOK,
		comoJSON(t, dias)); err != nil {
		t.Errorf("totales por dia violan el esquema: %v", err)
	}

	ruta, _, err := router.FindRoute(httptest.NewRequest(http.MethodGet, base+m+"/payments/daily", nil))
	if err != nil {
		t.Fatalf("GET /payments/daily no esta en el spec: %v", err)
	}
	periodo := ruta.Operation.Parameters.GetByInAndName("query", "period")
	if periodo == nil || !periodo.Required || len(periodo.Schema.Value.Enum) != 4 {
		t.Errorf("GET /payments/daily debe exigir period con sus cuatro valores: %+v", periodo)
	}
	if ruta.Operation.Parameters.GetByInAndName("query", "tz") == nil {
		t.Error("GET /payments/daily no documenta tz")
	}
}

func TestInterfazDelComercio_ElResumenEstaEnElContrato(t *testing.T) {
	router := routerDeLaSpec(t)
	m := "/api/v1/qr/merchants/" + merchUUID

	conComparacion := qrpayment.ResumenDelComercio{
		Plan: qrpayment.PlanComercioAnalitica,
		Periods: []qrpayment.ResumenDelPeriodo{{
			Period: qrpayment.PeriodoMes, From: "2026-10-01", To: "2026-10-29",
			PreviousFrom: "2026-09-01", PreviousTo: "2026-09-29",
			Currencies: []qrpayment.ResumenMoneda{{
				Currency: "CRC", Gross: 160000, Fee: 800, Net: 159200, Count: 3,
				Previous: &qrpayment.ReportBucket{Gross: 60000, Fee: 300, Net: 59700, Count: 1},
				Delta: &qrpayment.ReportDelta{
					Gross: 100000, Fee: 500, Net: 99500, Count: 2,
					GrossPct: pct(166.67), NetPct: pct(166.67), CountPct: pct(200),
				},
			}},
		}},
	}
	if err := contract.ValidateData(router, http.MethodGet, base+m+"/summary?tz=360", http.StatusOK,
		comoJSON(t, conComparacion)); err != nil {
		t.Errorf("resumen con comparacion viola el esquema: %v", err)
	}

	// Plan base: sin periodo anterior, sin comparacion, y un periodo sin ventas
	// con la lista de monedas vacia.
	planBase := qrpayment.ResumenDelComercio{
		Plan: qrpayment.PlanComercioBase,
		Periods: []qrpayment.ResumenDelPeriodo{
			{Period: qrpayment.PeriodoHoy, From: "2026-10-29", To: "2026-10-29", Currencies: []qrpayment.ResumenMoneda{}},
		},
	}
	if err := contract.ValidateData(router, http.MethodGet, base+m+"/summary", http.StatusOK,
		comoJSON(t, planBase)); err != nil {
		t.Errorf("resumen del plan base viola el esquema: %v", err)
	}

	rec := httptest.NewRecorder()
	response.Error(rec, http.StatusNotFound, "NOT_FOUND", "merchant not found")
	if err := contract.ValidateResponseBody(router, http.MethodGet, base+m+"/summary", http.StatusNotFound, rec.Body.Bytes()); err != nil {
		t.Errorf("resumen (404) viola el esquema: %v", err)
	}
}

func TestInterfazDelComercio_LosRetirosEstanEnElContrato(t *testing.T) {
	router := routerDeLaSpec(t)
	ahora := time.Date(2026, 10, 29, 14, 0, 0, 0, time.UTC)
	m := "/api/v1/qr/merchants/" + merchUUID

	retiros := []qrpayment.RetiroDelComercio{
		{ID: unUUID, Amount: 50000, Currency: "CRC", Status: "completed", WithdrawnByName: "Keilor Martinez", CreatedAt: ahora},
	}
	if err := contract.ValidateData(router, http.MethodGet, base+m+"/withdrawals?period=today&tz=360", http.StatusOK,
		comoJSON(t, retiros)); err != nil {
		t.Errorf("retiros violan el esquema: %v", err)
	}

	ruta, _, err := router.FindRoute(httptest.NewRequest(http.MethodGet, base+m+"/withdrawals", nil))
	if err != nil {
		t.Fatalf("GET /withdrawals no esta en el spec: %v", err)
	}
	periodo := ruta.Operation.Parameters.GetByInAndName("query", "period")
	if periodo == nil || !periodo.Required {
		t.Errorf("GET /withdrawals debe exigir period: %+v", periodo)
	}
}

// El reporte y su CSV aceptan el mismo periodo que los movimientos: exportar
// "mes anterior" no se puede pedir con `days`.
func TestInterfazDelComercio_ElReporteYElCSVAceptanPeriodo(t *testing.T) {
	router := routerDeLaSpec(t)
	m := base + "/api/v1/qr/merchants/" + merchUUID

	for _, sufijo := range []string{"/report", "/report.csv"} {
		ruta, _, err := router.FindRoute(httptest.NewRequest(http.MethodGet, m+sufijo, nil))
		if err != nil {
			t.Fatalf("GET %s no esta en el spec: %v", sufijo, err)
		}
		periodo := ruta.Operation.Parameters.GetByInAndName("query", "period")
		if periodo == nil || periodo.Required || len(periodo.Schema.Value.Enum) != 4 {
			t.Errorf("GET %s debe aceptar period (opcional, cuatro valores): %+v", sufijo, periodo)
		}
	}
	rec := httptest.NewRecorder()
	response.Error(rec, http.StatusBadRequest, "INVALID_PERIOD", "period must be today, week, month or prev_month")
	if err := contract.ValidateResponseBody(router, http.MethodGet, m+"/report.csv", http.StatusBadRequest, rec.Body.Bytes()); err != nil {
		t.Errorf("GET /report.csv (400 INVALID_PERIOD) viola el esquema: %v", err)
	}
}

// La lista de comercios de quien trabaja en uno trae el nombre de su dueno.
func TestInterfazDelComercio_LaListaDeComerciosTraeElNombreDelDueno(t *testing.T) {
	router := routerDeLaSpec(t)
	ahora := time.Date(2026, 10, 29, 15, 0, 0, 0, time.UTC)

	delCajero := qrpayment.Merchant{
		ID: merchUUID, UserID: unUUID, Name: "Super La Esquina", Category: "retail",
		Cedula: "3-101-123", CedulaType: "juridica", LegalName: "La Esquina SA",
		VerificationStatus: "verified", CommissionBps: 50, ComisionEfectivaBps: 50,
		Plan: qrpayment.PlanComercioBase, CreatedAt: ahora, Role: qrpayment.RoleCashier,
		OwnerName: "Keilor Martinez",
	}
	if err := contract.ValidateData(router, http.MethodGet, base+"/api/v1/qr/merchants", http.StatusOK,
		comoJSON(t, []qrpayment.Merchant{delCajero})); err != nil {
		t.Errorf("comercios de un cajero violan el esquema: %v", err)
	}
}
