package contract_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/getkin/kin-openapi/routers"

	"github.com/kiramopay/backend/internal/contract"
	"github.com/kiramopay/backend/internal/plans"
	"github.com/kiramopay/backend/internal/qrpayment"
	"github.com/kiramopay/backend/internal/user"
	"github.com/kiramopay/backend/pkg/response"
)

// Contrato de los planes (13-09-2026). Cada caso arma el valor con los MISMOS
// tipos que escriben los handlers, no con una copia a mano del JSON: asi un
// campo que el backend agrega o quita y el esquema no, rompe aqui.

const (
	base      = "http://localhost:8080"
	unUUID    = "00000000-0000-0000-0000-000000000001"
	otroUUID  = "00000000-0000-0000-0000-000000000002"
	merchUUID = "00000000-0000-0000-0000-0000000000c1"
)

func routerDeLaSpec(t *testing.T) routers.Router {
	t.Helper()
	doc, err := contract.LoadSpec(specPath)
	if err != nil {
		t.Fatalf("load spec: %v", err)
	}
	router, err := contract.NewRouter(doc)
	if err != nil {
		t.Fatalf("router: %v", err)
	}
	return router
}

// comoJSON pasa un valor por JSON y lo devuelve decodificado, que es lo que
// valida ValidateData.
func comoJSON(t *testing.T, v any) any {
	t.Helper()
	crudo, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var out any
	if err := json.Unmarshal(crudo, &out); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	return out
}

func TestUsersMe_LlevaElPlan(t *testing.T) {
	router := routerDeLaSpec(t)
	ahora := time.Now().UTC()
	u := user.UserRecord{
		ID: unUUID, Cedula: "702650930", Phone: "+50688881234", FirstName: "Keilor", LastName: "Martinez",
		KYCStatus: "pending", Status: "active", ReferralCode: "K7PM3XQ2", Plan: "plus",
		CreatedAt: ahora, UpdatedAt: ahora,
	}
	cuerpo, _ := json.Marshal(response.APIResponse{Success: true, Data: u})
	if err := contract.ValidateResponseBody(router, http.MethodGet, base+"/api/v1/users/me", http.StatusOK, cuerpo); err != nil {
		t.Fatalf("/users/me viola el esquema: %v", err)
	}

	// El enum esta vivo: un plan inventado no pasa.
	u.Plan = "gold"
	cuerpo, _ = json.Marshal(response.APIResponse{Success: true, Data: u})
	if err := contract.ValidateResponseBody(router, http.MethodGet, base+"/api/v1/users/me", http.StatusOK, cuerpo); err == nil {
		t.Fatal("un plan fuera de free|plus|pro paso el contrato")
	}
}

func TestErroresDeTope_CumplenElContrato(t *testing.T) {
	router := routerDeLaSpec(t)
	casos := []struct{ ruta, codigo string }{
		{"/api/v1/cards", "CARD_LIMIT"},
		{"/api/v1/savings/goals", "SAVINGS_GOAL_LIMIT"},
	}
	for _, c := range casos {
		rec := httptest.NewRecorder()
		tope := &plans.TopeAlcanzadoError{Plan: plans.PlanFree, Limite: 1, Actuales: 2}
		response.ErrorConDetalle(rec, http.StatusConflict, c.codigo, "limite del plan", tope.Detalle())
		if err := contract.ValidateResponseBody(router, http.MethodPost, base+c.ruta, http.StatusConflict, rec.Body.Bytes()); err != nil {
			t.Errorf("%s 409 viola el esquema: %v", c.ruta, err)
		}

		// Sin details no cumple: la pantalla depende de esos tres numeros.
		sinDetalle := httptest.NewRecorder()
		response.Error(sinDetalle, http.StatusConflict, c.codigo, "limite del plan")
		if err := contract.ValidateResponseBody(router, http.MethodPost, base+c.ruta, http.StatusConflict, sinDetalle.Body.Bytes()); err == nil {
			t.Errorf("%s: un 409 sin details paso el contrato", c.ruta)
		}
	}
}

func TestExportarSinPlan_CumpleElContrato(t *testing.T) {
	router := routerDeLaSpec(t)
	rec := httptest.NewRecorder()
	response.ErrorConDetalle(rec, http.StatusForbidden, "PLAN_REQUIRED", "falta el plan",
		map[string]any{"plan_requerido": qrpayment.PlanComercioAnalitica})
	ruta := base + "/api/v1/qr/merchants/" + merchUUID + "/report.csv"
	if err := contract.ValidateResponseBody(router, http.MethodGet, ruta, http.StatusForbidden, rec.Body.Bytes()); err != nil {
		t.Fatalf("403 PLAN_REQUIRED viola el esquema: %v", err)
	}
}

func TestComercio_CumpleElContrato(t *testing.T) {
	router := routerDeLaSpec(t)
	ahora := time.Now().UTC()
	promo := ahora.AddDate(0, qrpayment.PromoEntradaMeses, 0)

	enPromocion := qrpayment.Merchant{
		ID: merchUUID, UserID: unUUID, Name: "Soda Tica", Category: "restaurant", QRCode: "MRC-0011223344556677",
		Active: true, Cedula: "3-101-123", CedulaType: "juridica", LegalName: "Soda Tica SA",
		VerificationStatus: "verified", ReviewedAt: &ahora, CommissionBps: 50, CreatedAt: ahora,
		Plan: qrpayment.PlanComercioAnalitica, ComisionEfectivaBps: qrpayment.PromoEntradaBps, PromoHasta: &promo,
		PrimeraAprobacionAt: &ahora, Role: qrpayment.RoleOwner,
	}
	sinPromocion := enPromocion
	sinPromocion.ID = otroUUID
	sinPromocion.Plan = qrpayment.PlanComercioBase
	sinPromocion.PromoHasta = nil
	sinPromocion.ComisionEfectivaBps = qrpayment.DefaultCommissionBps
	sinPromocion.ReviewedAt = nil
	sinPromocion.VerificationStatus = "pending"
	sinPromocion.Role = ""

	if err := contract.ValidateData(router, http.MethodGet, base+"/api/v1/qr/merchants", http.StatusOK,
		comoJSON(t, []qrpayment.Merchant{enPromocion, sinPromocion})); err != nil {
		t.Fatalf("lista de comercios viola el esquema: %v", err)
	}
	for _, ruta := range []string{
		"/api/v1/admin/merchants/" + merchUUID + "/approve",
	} {
		if err := contract.ValidateData(router, http.MethodPost, base+ruta, http.StatusOK, comoJSON(t, enPromocion)); err != nil {
			t.Errorf("POST %s viola el esquema: %v", ruta, err)
		}
	}
	if err := contract.ValidateData(router, http.MethodPatch, base+"/api/v1/admin/merchants/"+merchUUID+"/plan",
		http.StatusOK, comoJSON(t, sinPromocion)); err != nil {
		t.Fatalf("PATCH plan de comercio viola el esquema: %v", err)
	}
}

func TestReporte_CumpleElContrato(t *testing.T) {
	router := routerDeLaSpec(t)
	cien := 100.0
	rep := qrpayment.MerchantReport{
		Days: 7, From: "2026-09-07", To: "2026-09-13",
		Totals: qrpayment.ReportBucket{Gross: 20000, Fee: 50, Net: 19950, Count: 1},
		Daily:  []qrpayment.ReportDay{{Date: "2026-09-13", Gross: 20000, Fee: 50, Net: 19950, Count: 1}},
		ByLocation: []qrpayment.ReportBucket{
			{Key: unUUID, Label: "Sucursal Centro", Gross: 15000, Fee: 38, Net: 14962, Count: 1},
			{Gross: 5000, Fee: 12, Net: 4988, Count: 1},
		},
		ByCollector: []qrpayment.ReportBucket{},
		Plan:        qrpayment.PlanComercioAnalitica,
		Comparison: &qrpayment.ReportComparison{
			PreviousFrom: "2026-08-31", PreviousTo: "2026-09-06",
			PreviousTotals: qrpayment.ReportBucket{Gross: 10000, Fee: 25, Net: 9975, Count: 1},
			Delta:          qrpayment.ReportDelta{Gross: 10000, Fee: 25, Net: 9975, Count: 0, GrossPct: &cien},
		},
	}
	ruta := base + "/api/v1/qr/merchants/" + merchUUID + "/report"
	if err := contract.ValidateData(router, http.MethodGet, ruta, http.StatusOK, comoJSON(t, rep)); err != nil {
		t.Fatalf("reporte con comparacion viola el esquema: %v", err)
	}

	rep.Plan = qrpayment.PlanComercioBase
	rep.Comparison = nil
	if err := contract.ValidateData(router, http.MethodGet, ruta, http.StatusOK, comoJSON(t, rep)); err != nil {
		t.Fatalf("reporte base viola el esquema: %v", err)
	}
}

func TestPlanAsignado_CumpleElContrato(t *testing.T) {
	router := routerDeLaSpec(t)
	asignado := plans.PlanAsignado{UserID: unUUID, Plan: plans.PlanPro, PlanAnterior: plans.PlanFree, UpdatedAt: time.Now().UTC()}
	if err := contract.ValidateData(router, http.MethodPatch, base+"/api/v1/admin/users/"+unUUID+"/plan",
		http.StatusOK, comoJSON(t, asignado)); err != nil {
		t.Fatalf("PATCH plan personal viola el esquema: %v", err)
	}
}
