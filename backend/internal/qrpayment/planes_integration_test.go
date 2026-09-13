package qrpayment_test

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kiramopay/backend/internal/audit"
	"github.com/kiramopay/backend/internal/middleware"
	"github.com/kiramopay/backend/internal/qrpayment"
	"github.com/kiramopay/backend/internal/user"
)

// Promocion de entrada, plan analitica y rutas de administrador del comercio
// (decision del dueno del 13-09-2026).

func registrarComercio(t *testing.T, svc *qrpayment.Service, owner, nombre string) *qrpayment.Merchant {
	t.Helper()
	m, err := svc.RegisterMerchant(context.Background(), owner, &qrpayment.RegisterMerchantRequest{
		Name: nombre, Category: "restaurant", Cedula: "3-101-123", CedulaType: "juridica", LegalName: nombre + " SA",
	})
	if err != nil {
		t.Fatalf("registrar comercio %s: %v", nombre, err)
	}
	return m
}

func pagarAlComercio(t *testing.T, svc *qrpayment.Service, payer, owner, merchantID string, monto int64) *qrpayment.QRPaymentRecord {
	t.Helper()
	ctx := context.Background()
	code, err := svc.CreateQRCode(ctx, owner, &qrpayment.CreateQRCodeRequest{
		Type: "merchant_fixed", Amount: monto, Currency: "CRC", MerchantID: merchantID,
	})
	if err != nil {
		t.Fatalf("cobro de %d: %v", monto, err)
	}
	pay, err := svc.ScanAndPay(ctx, payer, &qrpayment.ScanQRPaymentRequest{QRData: code.QRData, Currency: "CRC"})
	if err != nil {
		t.Fatalf("pago de %d: %v", monto, err)
	}
	return pay
}

func marcasDePromocion(t *testing.T, pool *pgxpool.Pool, merchantID string) (primeraAprobacion, promoHasta *time.Time) {
	t.Helper()
	if err := pool.QueryRow(context.Background(),
		`SELECT primera_aprobacion_at, promo_hasta FROM qr_merchants WHERE id = $1::uuid`, merchantID,
	).Scan(&primeraAprobacion, &promoHasta); err != nil {
		t.Fatalf("leer marcas: %v", err)
	}
	return primeraAprobacion, promoHasta
}

// ── Promocion de entrada ────────────────────────────────────────────────────

func TestPromocion_LaPrimeraAprobacionLaOtorga(t *testing.T) {
	svc, _, payer, owner := setupQR(t)
	ctx := context.Background()

	m := registrarComercio(t, svc, owner, "Soda Nueva")
	if m.Plan != qrpayment.PlanComercioBase || m.PromoHasta != nil || m.ComisionEfectivaBps != qrpayment.DefaultCommissionBps {
		t.Fatalf("recien registrado: plan=%q promo=%v efectiva=%d", m.Plan, m.PromoHasta, m.ComisionEfectivaBps)
	}

	antes := time.Now()
	aprobado, err := svc.ApproveMerchant(ctx, m.ID, owner)
	if err != nil {
		t.Fatalf("aprobar: %v", err)
	}
	if aprobado.PromoHasta == nil {
		t.Fatal("la primera aprobacion no otorgo la promocion")
	}
	// Holgura de dias: Postgres y Go no suman meses igual a fin de mes.
	minimo := antes.AddDate(0, qrpayment.PromoEntradaMeses, -4)
	maximo := time.Now().AddDate(0, qrpayment.PromoEntradaMeses, 4)
	if aprobado.PromoHasta.Before(minimo) || aprobado.PromoHasta.After(maximo) {
		t.Fatalf("promo_hasta = %v, se esperaba unos %d meses despues de aprobar", aprobado.PromoHasta, qrpayment.PromoEntradaMeses)
	}
	if aprobado.CommissionBps != qrpayment.DefaultCommissionBps || aprobado.ComisionEfectivaBps != qrpayment.PromoEntradaBps {
		t.Fatalf("comision=%d efectiva=%d, se esperaba 50 y 25", aprobado.CommissionBps, aprobado.ComisionEfectivaBps)
	}

	pay := pagarAlComercio(t, svc, payer, owner, m.ID, 100000)
	if pay.Fee != 250 { // 0,25 % de 100000 centimos
		t.Fatalf("comision cobrada = %d, se esperaba 250", pay.Fee)
	}

	ms, err := svc.GetMerchants(ctx, owner)
	if err != nil || len(ms) != 1 {
		t.Fatalf("GetMerchants: %+v (err %v)", ms, err)
	}
	if ms[0].ComisionEfectivaBps != qrpayment.PromoEntradaBps || ms[0].PromoHasta == nil || ms[0].Plan != qrpayment.PlanComercioBase {
		t.Fatalf("lo que ve el dueno: %+v", ms[0])
	}
}

func TestPromocion_AlVencerVuelveLaComisionDelComercio(t *testing.T) {
	svc, pool, payer, owner := setupQR(t)
	ctx := context.Background()
	m := comercioVerificado(t, svc, owner)
	terminarPromocion(t, pool, m.ID)

	pay := pagarAlComercio(t, svc, payer, owner, m.ID, 100000)
	if pay.Fee != 500 {
		t.Fatalf("comision cobrada = %d, se esperaba 500 (0,50 %%) con la promocion vencida", pay.Fee)
	}
	ms, err := svc.GetMerchants(ctx, owner)
	if err != nil || len(ms) != 1 || ms[0].ComisionEfectivaBps != qrpayment.DefaultCommissionBps || ms[0].PromoHasta == nil {
		t.Fatalf("vencida: %+v (err %v); la fecha se conserva y la efectiva vuelve a 50", ms, err)
	}
}

func TestPromocion_UnaComisionMenorFijadaSeRespeta(t *testing.T) {
	svc, pool, payer, owner := setupQR(t)
	ctx := context.Background()
	m := comercioVerificado(t, svc, owner)

	menor, err := svc.SetCommission(ctx, m.ID, 10)
	if err != nil {
		t.Fatalf("fijar 10 bps: %v", err)
	}
	if menor.ComisionEfectivaBps != 10 {
		t.Fatalf("efectiva con 10 bps fijados = %d, se esperaba 10", menor.ComisionEfectivaBps)
	}
	if pay := pagarAlComercio(t, svc, payer, owner, m.ID, 100000); pay.Fee != 100 {
		t.Fatalf("comision = %d, se esperaba 100 (la menor)", pay.Fee)
	}

	mayor, err := svc.SetCommission(ctx, m.ID, 100)
	if err != nil {
		t.Fatalf("fijar 100 bps: %v", err)
	}
	if mayor.CommissionBps != 100 || mayor.ComisionEfectivaBps != qrpayment.PromoEntradaBps {
		t.Fatalf("con 100 bps fijados: comision=%d efectiva=%d", mayor.CommissionBps, mayor.ComisionEfectivaBps)
	}
	if pay := pagarAlComercio(t, svc, payer, owner, m.ID, 100000); pay.Fee != 250 {
		t.Fatalf("comision = %d, se esperaba 250 (la promocion)", pay.Fee)
	}

	terminarPromocion(t, pool, m.ID)
	if pay := pagarAlComercio(t, svc, payer, owner, m.ID, 100000); pay.Fee != 1000 {
		t.Fatalf("comision = %d, se esperaba 1000 (la fijada, sin promocion)", pay.Fee)
	}
}

func TestPromocion_NoSeRenuevaNiSeAlargaAlReaprobar(t *testing.T) {
	svc, pool, _, owner := setupQR(t)
	ctx := context.Background()
	m := comercioVerificado(t, svc, owner)
	terminarPromocion(t, pool, m.ID)
	_, vencida := marcasDePromocion(t, pool, m.ID)

	if _, err := svc.RejectMerchant(ctx, m.ID, owner, "documento ilegible"); err != nil {
		t.Fatalf("rechazar: %v", err)
	}
	re, err := svc.ApproveMerchant(ctx, m.ID, owner)
	if err != nil {
		t.Fatalf("re-aprobar: %v", err)
	}
	if re.PromoHasta == nil || !re.PromoHasta.Equal(*vencida) || re.ComisionEfectivaBps != qrpayment.DefaultCommissionBps {
		t.Fatalf("tras rechazo y re-aprobacion: promo=%v efectiva=%d; la promocion no se renueva", re.PromoHasta, re.ComisionEfectivaBps)
	}

	// Cambio de identidad: vuelve a pending y un administrador lo re-aprueba.
	cambiado, err := svc.UpdateMerchant(ctx, m.ID, owner, &qrpayment.RegisterMerchantRequest{
		Name: "Soda Tica", Category: "restaurant", Cedula: "702650930", CedulaType: "fisica", LegalName: "Otra Persona",
	})
	if err != nil || cambiado.VerificationStatus != "pending" {
		t.Fatalf("cambio de identidad: %+v (err %v)", cambiado, err)
	}
	re2, err := svc.ApproveMerchant(ctx, m.ID, owner)
	if err != nil {
		t.Fatalf("re-aprobar tras cambio de identidad: %v", err)
	}
	if re2.PromoHasta == nil || !re2.PromoHasta.Equal(*vencida) {
		t.Fatalf("tras cambio de identidad: promo=%v; la promocion no se renueva", re2.PromoHasta)
	}
}

func TestPromocion_UnComercioYaAprobadoAntesNoLaRecibe(t *testing.T) {
	svc, pool, _, owner := setupQR(t)
	ctx := context.Background()
	m := registrarComercio(t, svc, owner, "Soda Antigua")

	// Asi deja la migracion 068 a un comercio aprobado antes del despliegue que
	// despues cambio su cedula y volvio a pending.
	if _, err := pool.Exec(ctx,
		`UPDATE qr_merchants SET primera_aprobacion_at = NOW() - INTERVAL '90 days' WHERE id = $1::uuid`, m.ID); err != nil {
		t.Fatalf("marcar: %v", err)
	}
	a, err := svc.ApproveMerchant(ctx, m.ID, owner)
	if err != nil {
		t.Fatalf("aprobar: %v", err)
	}
	if a.PromoHasta != nil || a.ComisionEfectivaBps != qrpayment.DefaultCommissionBps {
		t.Fatalf("un comercio ya aprobado recibio la promocion: promo=%v efectiva=%d", a.PromoHasta, a.ComisionEfectivaBps)
	}
}

// La migracion se prueba ejecutando SU PROPIO archivo, como la 063: el esquema
// de pruebas no lee migrations/.
func TestMigracion068_MarcaSoloALosQueYaEstuvieronAprobados(t *testing.T) {
	svc, pool, _, owner := setupQR(t)
	ctx := context.Background()

	verificado := registrarComercio(t, svc, owner, "Verificado")
	conRotulo := registrarComercio(t, svc, owner, "Pendiente con rotulo")
	nuevo := registrarComercio(t, svc, owner, "Pendiente nuevo")
	rechazado := registrarComercio(t, svc, owner, "Rechazado")

	if _, err := pool.Exec(ctx,
		`UPDATE qr_merchants SET verification_status = 'verified', reviewed_at = NOW() - INTERVAL '30 days'
		  WHERE id = $1::uuid`, verificado.ID); err != nil {
		t.Fatalf("preparar verificado: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`UPDATE qr_merchants SET verification_status = 'rejected' WHERE id = $1::uuid`, rechazado.ID); err != nil {
		t.Fatalf("preparar rechazado: %v", err)
	}
	// Un comercio aprobado que cambio su cedula esta en 'pending', pero su rotulo
	// prueba que estuvo aprobado: emitirlo exige la verificacion.
	if _, err := pool.Exec(ctx,
		`INSERT INTO qr_payment_codes (creator_id, type, amount, currency, merchant_id, qr_data, status)
		 VALUES ($1::uuid, 'merchant_fixed', 0, 'CRC', $2::uuid, $3, 'historic')`,
		owner, conRotulo.ID, "PRUEBA-068-"+conRotulo.ID); err != nil {
		t.Fatalf("preparar rotulo: %v", err)
	}

	sql, err := os.ReadFile("../../migrations/068_planes_y_promocion.sql")
	if err != nil {
		t.Fatalf("leer migracion: %v", err)
	}
	if _, err := pool.Exec(ctx, string(sql)); err != nil {
		t.Fatalf("correr migracion: %v", err)
	}

	v1, p1 := marcasDePromocion(t, pool, verificado.ID)
	if v1 == nil || p1 != nil {
		t.Fatalf("verificado: primera_aprobacion=%v promo=%v; se esperaba marcado y sin promocion", v1, p1)
	}
	if time.Since(*v1) < 29*24*time.Hour {
		t.Fatalf("verificado: la marca es %v; debia ser la fecha de su revision, no la de hoy", *v1)
	}
	if v2, p2 := marcasDePromocion(t, pool, conRotulo.ID); v2 == nil || p2 != nil {
		t.Fatalf("pendiente con rotulo: primera_aprobacion=%v promo=%v; se esperaba marcado", v2, p2)
	}
	if v3, _ := marcasDePromocion(t, pool, nuevo.ID); v3 != nil {
		t.Fatalf("pendiente nuevo: quedo marcado (%v) sin haber sido aprobado nunca", *v3)
	}
	if v4, _ := marcasDePromocion(t, pool, rechazado.ID); v4 != nil {
		t.Fatalf("rechazado sin historia: quedo marcado (%v)", *v4)
	}

	// Una segunda pasada no cambia nada.
	if _, err := pool.Exec(ctx, string(sql)); err != nil {
		t.Fatalf("segunda pasada: %v", err)
	}
	if otra, _ := marcasDePromocion(t, pool, verificado.ID); otra == nil || !otra.Equal(*v1) {
		t.Fatalf("la segunda pasada movio la marca: %v -> %v", *v1, otra)
	}

	// Lo que eso significa al aprobar.
	if a, err := svc.ApproveMerchant(ctx, conRotulo.ID, owner); err != nil || a.PromoHasta != nil {
		t.Fatalf("ya aprobado antes: promo=%v (err %v); no la recibe", a.PromoHasta, err)
	}
	if b, err := svc.ApproveMerchant(ctx, nuevo.ID, owner); err != nil || b.PromoHasta == nil {
		t.Fatalf("nuevo: promo=%v (err %v); la recibe", b.PromoHasta, err)
	}
	if c, err := svc.ApproveMerchant(ctx, rechazado.ID, owner); err != nil || c.PromoHasta == nil {
		t.Fatalf("rechazado sin haber sido aprobado: promo=%v (err %v); la recibe", c.PromoHasta, err)
	}
}

// ── Plan analitica ──────────────────────────────────────────────────────────

func TestReporte_LaComparacionEsDelPlanAnalitica(t *testing.T) {
	svc, pool, payer, owner := setupQR(t)
	ctx := context.Background()
	m := comercioVerificado(t, svc, owner)

	pagarAlComercio(t, svc, payer, owner, m.ID, 20000)
	anterior := pagarAlComercio(t, svc, payer, owner, m.ID, 10000)
	// Corrida una semana atras, la segunda venta cae en la ventana anterior de
	// un reporte de 7 dias.
	if _, err := pool.Exec(ctx,
		`UPDATE qr_payments SET created_at = created_at - INTERVAL '7 days' WHERE id = $1::uuid`, anterior.ID); err != nil {
		t.Fatalf("mover venta: %v", err)
	}

	base, err := svc.MerchantReport(ctx, m.ID, owner, 7, 0)
	if err != nil {
		t.Fatalf("reporte base: %v", err)
	}
	if base.Plan != qrpayment.PlanComercioBase || base.Comparison != nil {
		t.Fatalf("plan base: plan=%q comparacion=%+v; sin analitica no hay comparacion", base.Plan, base.Comparison)
	}
	if base.Totals.Gross != 20000 || base.Totals.Count != 1 || base.From == "" || base.To == "" {
		t.Fatalf("reporte base: %+v", base)
	}

	if _, err := svc.AsignarPlanComercio(ctx, m.ID, owner, qrpayment.PlanComercioAnalitica, qrpayment.ActorContext{}); err != nil {
		t.Fatalf("asignar analitica: %v", err)
	}
	rep, err := svc.MerchantReport(ctx, m.ID, owner, 7, 0)
	if err != nil {
		t.Fatalf("reporte analitica: %v", err)
	}
	c := rep.Comparison
	if rep.Plan != qrpayment.PlanComercioAnalitica || c == nil {
		t.Fatalf("plan analitica sin comparacion: %+v", rep)
	}
	if c.PreviousTotals.Gross != 10000 || c.PreviousTotals.Count != 1 {
		t.Fatalf("ventana anterior: %+v", c.PreviousTotals)
	}
	if c.Delta.Gross != 10000 || c.Delta.Count != 0 || c.Delta.Net != rep.Totals.Net-c.PreviousTotals.Net {
		t.Fatalf("delta: %+v", c.Delta)
	}
	if c.Delta.GrossPct == nil || *c.Delta.GrossPct != 100 || c.Delta.CountPct == nil || *c.Delta.CountPct != 0 {
		t.Fatalf("porcentajes: bruto=%v cobros=%v", c.Delta.GrossPct, c.Delta.CountPct)
	}
	if len(c.PreviousFrom) != 10 || len(c.PreviousTo) != 10 || c.PreviousTo >= rep.From {
		t.Fatalf("fechas de la ventana anterior: %s a %s (el reporte arranca %s)", c.PreviousFrom, c.PreviousTo, rep.From)
	}

	// Sin ventas en la ventana anterior el porcentaje no se inventa.
	if _, err := pool.Exec(ctx,
		`UPDATE qr_payments SET created_at = created_at - INTERVAL '30 days' WHERE id = $1::uuid`, anterior.ID); err != nil {
		t.Fatalf("mover venta: %v", err)
	}
	rep, err = svc.MerchantReport(ctx, m.ID, owner, 7, 0)
	if err != nil {
		t.Fatalf("reporte: %v", err)
	}
	if rep.Comparison.PreviousTotals.Count != 0 || rep.Comparison.Delta.GrossPct != nil {
		t.Fatalf("ventana anterior vacia: %+v", rep.Comparison)
	}
}

func TestAsignarPlanComercio_AuditaConRiesgoAlto(t *testing.T) {
	_, pool, _, owner := setupQR(t)
	ctx := context.Background()
	logger := audit.NewLogger(audit.NewRepository(pool), 10)
	svc := qrpayment.NewService(qrpayment.NewRepository(pool), nil, user.NewRepository(pool),
		&qrpayment.Options{AuditLogger: logger})
	m := registrarComercio(t, svc, owner, "Soda Auditada")

	ac := qrpayment.ActorContext{IPAddress: "127.0.0.1", UserAgent: "test"}
	if _, err := svc.AsignarPlanComercio(ctx, m.ID, owner, "premium", ac); err == nil {
		t.Fatal("un plan de comercio inventado se acepto")
	}
	got, err := svc.AsignarPlanComercio(ctx, m.ID, owner, qrpayment.PlanComercioAnalitica, ac)
	if err != nil {
		t.Fatalf("asignar analitica: %v", err)
	}
	if got.Plan != qrpayment.PlanComercioAnalitica {
		t.Fatalf("plan = %q", got.Plan)
	}
	logger.Stop()

	var risk, actorID, recurso, anterior, nuevo string
	if err := pool.QueryRow(ctx,
		`SELECT risk_level, user_id::text, resource_id, details->>'plan_anterior', details->>'plan_nuevo'
		   FROM audit_logs WHERE action = 'admin_merchant_plan_set'`,
	).Scan(&risk, &actorID, &recurso, &anterior, &nuevo); err != nil {
		t.Fatalf("leer auditoria (debe haber exactamente una fila): %v", err)
	}
	if risk != "high" || actorID != owner || recurso != m.ID || anterior != "base" || nuevo != "analitica" {
		t.Fatalf("rastro: risk=%s actor=%s recurso=%s %s->%s", risk, actorID, recurso, anterior, nuevo)
	}
}

func TestReporteCSV_YPlanDelComercio_PorHTTP(t *testing.T) {
	svc, pool, payer, owner := setupQR(t)
	ctx := context.Background()
	h := qrpayment.NewHandler(qrpayment.NewService(qrpayment.NewRepository(pool), nil, user.NewRepository(pool), nil))

	m := comercioVerificado(t, svc, owner)
	// El nombre de una sucursal lo escribe el dueno: es el vector de inyeccion.
	const nombreMalicioso = `=HYPERLINK("http://malo","clic")`
	loc, err := svc.CreateLocation(ctx, m.ID, owner, &qrpayment.LocationRequest{Name: nombreMalicioso})
	if err != nil {
		t.Fatalf("crear sucursal: %v", err)
	}
	code, err := svc.CreateQRCode(ctx, owner, &qrpayment.CreateQRCodeRequest{
		Type: "merchant_fixed", Amount: 20000, Currency: "CRC", MerchantID: m.ID, LocationID: loc.ID,
	})
	if err != nil {
		t.Fatalf("cobro en la sucursal: %v", err)
	}
	if _, err := svc.ScanAndPay(ctx, payer, &qrpayment.ScanQRPaymentRequest{QRData: code.QRData, Currency: "CRC"}); err != nil {
		t.Fatalf("pago: %v", err)
	}

	router := chi.NewRouter()
	router.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			actor := r.Header.Get("X-Prueba-Usuario")
			next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), middleware.UserIDKey, actor)))
		})
	})
	router.Get("/qr/merchants/{id}/report.csv", h.GetMerchantReportCSV)
	router.Group(func(r chi.Router) {
		r.Use(middleware.RequireAdmin(user.NewRepository(pool)))
		r.Patch("/admin/merchants/{id}/plan", h.SetMerchantPlan)
	})

	pedir := func(metodo, ruta, actor, cuerpo string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(metodo, ruta, strings.NewReader(cuerpo))
		req.Header.Set("X-Prueba-Usuario", actor)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		return rec
	}
	type errorJSON struct {
		Success bool `json:"success"`
		Data    struct {
			Plan                string `json:"plan"`
			ComisionEfectivaBps int    `json:"comision_efectiva_bps"`
		} `json:"data"`
		Error struct {
			Code    string         `json:"code"`
			Details map[string]any `json:"details"`
		} `json:"error"`
	}
	leer := func(rec *httptest.ResponseRecorder) errorJSON {
		t.Helper()
		var e errorJSON
		if err := json.Unmarshal(rec.Body.Bytes(), &e); err != nil {
			t.Fatalf("la respuesta no es JSON (%d): %s", rec.Code, rec.Body.String())
		}
		return e
	}

	rutaCSV := "/qr/merchants/" + m.ID + "/report.csv?days=7&tz=0"

	// Quien no es del equipo: 404, igual que el reporte, sin saber que plan tiene.
	if rec := pedir(http.MethodGet, rutaCSV, payer, ""); rec.Code != http.StatusNotFound || leer(rec).Error.Code != "NOT_FOUND" {
		t.Fatalf("fuera del equipo: %d %s", rec.Code, rec.Body.String())
	}
	// El dueno sin el plan: 403 con el plan que falta.
	rec := pedir(http.MethodGet, rutaCSV, owner, "")
	if e := leer(rec); rec.Code != http.StatusForbidden || e.Error.Code != "PLAN_REQUIRED" ||
		e.Error.Details["plan_requerido"] != qrpayment.PlanComercioAnalitica {
		t.Fatalf("sin plan: %d %s", rec.Code, rec.Body.String())
	}

	rutaPlan := "/admin/merchants/" + m.ID + "/plan"
	// Quien no es administrador no se asigna el plan.
	if rec := pedir(http.MethodPatch, rutaPlan, payer, `{"plan":"analitica"}`); rec.Code != http.StatusForbidden || leer(rec).Error.Code != "FORBIDDEN" {
		t.Fatalf("no admin: %d %s", rec.Code, rec.Body.String())
	}
	casos := []struct {
		nombre, ruta, cuerpo string
		status               int
		codigo               string
	}{
		{"plan inventado", rutaPlan, `{"plan":"premium"}`, http.StatusBadRequest, "PLAN_INVALID"},
		{"mayusculas", rutaPlan, `{"plan":"Analitica"}`, http.StatusBadRequest, "PLAN_INVALID"},
		{"plan personal", rutaPlan, `{"plan":"pro"}`, http.StatusBadRequest, "PLAN_INVALID"},
		{"campo de mas", rutaPlan, `{"plan":"analitica","gratis":true}`, http.StatusBadRequest, "INVALID_BODY"},
		{"sin cuerpo", rutaPlan, ``, http.StatusBadRequest, "PLAN_INVALID"},
		{"id no es uuid", "/admin/merchants/no-es-uuid/plan", `{"plan":"analitica"}`, http.StatusBadRequest, "INVALID_ID"},
		{"comercio inexistente", "/admin/merchants/00000000-0000-0000-0000-0000000000ff/plan", `{"plan":"analitica"}`,
			http.StatusNotFound, "MERCHANT_NOT_FOUND"},
	}
	for _, c := range casos {
		rec := pedir(http.MethodPatch, c.ruta, owner, c.cuerpo)
		if e := leer(rec); rec.Code != c.status || e.Error.Code != c.codigo {
			t.Errorf("%s: %d %s, se esperaba %d %s", c.nombre, rec.Code, e.Error.Code, c.status, c.codigo)
		}
	}
	if rec := pedir(http.MethodGet, rutaCSV, owner, ""); rec.Code != http.StatusForbidden {
		t.Fatalf("un cuerpo rechazado habilito la analitica: %d", rec.Code)
	}

	rec = pedir(http.MethodPatch, rutaPlan, owner, `{"plan":"analitica"}`)
	if e := leer(rec); rec.Code != http.StatusOK || e.Data.Plan != "analitica" || e.Data.ComisionEfectivaBps != qrpayment.PromoEntradaBps {
		t.Fatalf("asignar analitica: %d %s", rec.Code, rec.Body.String())
	}

	rec = pedir(http.MethodGet, rutaCSV, owner, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("exportar con analitica: %d %s", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/csv") {
		t.Fatalf("Content-Type = %q", ct)
	}
	if cd := rec.Header().Get("Content-Disposition"); !strings.HasPrefix(cd, "attachment;") {
		t.Fatalf("Content-Disposition = %q", cd)
	}
	if rec.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("Cache-Control = %q: un reporte de ventas no se guarda en caches", rec.Header().Get("Cache-Control"))
	}
	const bom = "\xef\xbb\xbf"
	crudo := rec.Body.String()
	if !strings.HasPrefix(crudo, bom) {
		t.Fatal("el CSV no empieza con la marca de orden de bytes")
	}
	filas, err := csv.NewReader(strings.NewReader(strings.TrimPrefix(crudo, bom))).ReadAll()
	if err != nil {
		t.Fatalf("CSV invalido: %v", err)
	}
	var sucursal, anteriorFila []string
	for _, f := range filas[1:] {
		for _, celda := range f {
			if celda != "" && strings.ContainsRune("=+-@\t\r", rune(celda[0])) {
				t.Fatalf("celda que empieza como formula: %q", celda)
			}
		}
		if f[0] == "sucursal" && f[3] == loc.ID {
			sucursal = f
		}
		if f[0] == "periodo_anterior" {
			anteriorFila = f
		}
	}
	if sucursal == nil || sucursal[4] != "'"+nombreMalicioso || sucursal[5] != "200.00" {
		t.Fatalf("fila de la sucursal: %q", sucursal)
	}
	if anteriorFila == nil {
		t.Fatal("con analitica el CSV lleva el total del periodo anterior")
	}
}
