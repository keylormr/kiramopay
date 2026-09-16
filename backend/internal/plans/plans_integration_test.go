package plans_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kiramopay/backend/internal/audit"
	"github.com/kiramopay/backend/internal/middleware"
	"github.com/kiramopay/backend/internal/plans"
	"github.com/kiramopay/backend/internal/testutil"
	"github.com/kiramopay/backend/internal/user"
	"github.com/kiramopay/backend/pkg/hash"
)

// Tercer usuario con correo propio, fuera de los seeds fijos (...-0001 /
// ...-0002) para no chocar con otros paquetes bajo -p 1.
const (
	victorID     = "00000000-0000-0000-0000-0000000000b1"
	victorCedula = "987654321"
	victorPhone  = "+50670005678"
	victorEmail  = "victor@example.com"
)

type fixture struct {
	svc      *plans.Service
	pool     *pgxpool.Pool
	userRepo *user.Repository
	userID   string // seed 1: Test User, role user
	adminID  string // seed 2: Admin User, role admin
}

func setup(t *testing.T, opts *plans.Options) *fixture {
	t.Helper()
	pool := testutil.TestDB(t)
	userRepo := user.NewRepository(pool)

	pinHash, _ := hash.HashPin("Kiramopay2024!")
	userID := testutil.SeedTestUser(t, pool, "702650930", pinHash)
	adminID := testutil.SeedTestUser2(t, pool)
	seedVictor(t, pool)

	return &fixture{
		svc:      plans.NewService(pool, opts),
		pool:     pool,
		userRepo: userRepo,
		userID:   userID,
		adminID:  adminID,
	}
}

func seedVictor(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO users (id, cedula_enc, cedula_hash, phone_enc, phone_hash, email_enc, email_hash,
		        first_name, last_name, password_hash, status, kyc_level)
		 VALUES ($1, fn_pii_encrypt($2), fn_pii_hmac($2), fn_pii_encrypt($3), fn_pii_hmac($3),
		         fn_pii_encrypt($4), fn_pii_hmac($4), 'Victor', 'Lobo', 'dummy_hash', 'active', 1)
		 ON CONFLICT (id) DO NOTHING`,
		victorID, victorCedula, victorPhone, victorEmail,
	); err != nil {
		t.Fatalf("seed victor: %v", err)
	}
}

var actor = plans.ActorContext{IPAddress: "127.0.0.1", UserAgent: "test"}

func (f *fixture) filas(t *testing.T, userID string) int {
	t.Helper()
	var n int
	if err := f.pool.QueryRow(context.Background(),
		`SELECT count(*) FROM plan_interest WHERE user_id = $1::uuid`, userID).Scan(&n); err != nil {
		t.Fatalf("contar plan_interest: %v", err)
	}
	return n
}

func (f *fixture) planDe(t *testing.T, userID string) string {
	t.Helper()
	var p string
	if err := f.pool.QueryRow(context.Background(),
		`SELECT plan FROM users WHERE id = $1::uuid`, userID).Scan(&p); err != nil {
		t.Fatalf("leer plan: %v", err)
	}
	return p
}

func TestRegister_AnotaElInteres(t *testing.T) {
	f := setup(t, nil)

	got, err := f.svc.Register(context.Background(), victorID, "plus", actor)
	if err != nil {
		t.Fatalf("Register() error: %v", err)
	}
	if got.Plan != "plus" {
		t.Fatalf("plan = %q, esperaba plus", got.Plan)
	}
	if time.Since(got.RegisteredAt) > time.Minute {
		t.Fatalf("registered_at fuera de rango: %v", got.RegisteredAt)
	}
	if n := f.filas(t, victorID); n != 1 {
		t.Fatalf("filas = %d, esperaba 1", n)
	}
	// Anotar interes NO otorga el plan.
	if p := f.planDe(t, victorID); p != "free" {
		t.Fatalf("registrar interes cambio el plan a %q", p)
	}
}

func TestRegister_DosVeces_UnaSolaFilaConFechaNueva(t *testing.T) {
	f := setup(t, nil)
	ctx := context.Background()

	primero, err := f.svc.Register(ctx, victorID, "pro", actor)
	if err != nil {
		t.Fatalf("primer Register() error: %v", err)
	}
	// Sin esta pausa las dos marcas de tiempo pueden caer en el mismo
	// microsegundo y la comparacion de abajo no probaria nada.
	time.Sleep(5 * time.Millisecond)

	segundo, err := f.svc.Register(ctx, victorID, "pro", actor)
	if err != nil {
		t.Fatalf("segundo Register() error: %v", err)
	}
	if n := f.filas(t, victorID); n != 1 {
		t.Fatalf("filas = %d, esperaba 1: registrar dos veces no debe duplicar", n)
	}
	if !segundo.RegisteredAt.After(primero.RegisteredAt) {
		t.Fatalf("la fecha no se actualizo: %v -> %v", primero.RegisteredAt, segundo.RegisteredAt)
	}

	// Otro plan del MISMO usuario si es una fila aparte: el unico es (user, plan).
	if _, err := f.svc.Register(ctx, victorID, "analitica", actor); err != nil {
		t.Fatalf("Register(analitica) error: %v", err)
	}
	if n := f.filas(t, victorID); n != 2 {
		t.Fatalf("filas = %d, esperaba 2 (un plan distinto es otra fila)", n)
	}
}

func TestRegister_PlanInvalido(t *testing.T) {
	f := setup(t, nil)
	ctx := context.Background()

	// negocio y cima se retiraron el 13-09-2026; base es el plan que ya tiene
	// todo comercio y free el que ya tiene toda persona: no hay nada que pedir.
	for _, plan := range []string{"", "free", "gratis", "PLUS", "premium", "negocio", "cima", "base"} {
		if _, err := f.svc.Register(ctx, victorID, plan, actor); !errors.Is(err, plans.ErrPlanInvalid) {
			t.Errorf("Register(%q) = %v, esperaba ErrPlanInvalid", plan, err)
		}
	}
	if n := f.filas(t, victorID); n != 0 {
		t.Fatalf("filas = %d, esperaba 0: un plan invalido no debe escribir nada", n)
	}
}

// Quitar un plan no es borrar lo que la gente pidio: las filas viejas siguen
// en la base y en la lista del administrador.
func TestList_ConservaElInteresEnLosPlanesRetirados(t *testing.T) {
	f := setup(t, nil)
	ctx := context.Background()

	if _, err := f.pool.Exec(ctx,
		`INSERT INTO plan_interest (user_id, plan) VALUES ($1::uuid, 'negocio')`, victorID); err != nil {
		t.Fatalf("la base ya no acepta las filas viejas de negocio: %v", err)
	}
	rows, err := f.svc.List(ctx, 0)
	if err != nil {
		t.Fatalf("List() error: %v", err)
	}
	if len(rows) != 1 || rows[0].Plan != "negocio" {
		t.Fatalf("lista = %+v, esperaba la fila vieja de negocio", rows)
	}
}

func TestList_EnmascaraLaPII_YOrdenaPorFecha(t *testing.T) {
	f := setup(t, nil)
	ctx := context.Background()

	if _, err := f.svc.Register(ctx, f.userID, "plus", actor); err != nil {
		t.Fatalf("Register(userID) error: %v", err)
	}
	time.Sleep(5 * time.Millisecond)
	if _, err := f.svc.Register(ctx, victorID, "analitica", actor); err != nil {
		t.Fatalf("Register(victorID) error: %v", err)
	}

	rows, err := f.svc.List(ctx, 0)
	if err != nil {
		t.Fatalf("List() error: %v", err)
	}
	if len(rows) != 2 {
		t.Fatalf("List() devolvio %d filas, esperaba 2", len(rows))
	}
	// Mas reciente primero.
	if rows[0].UserID != victorID || rows[0].Plan != "analitica" {
		t.Fatalf("primera fila: %s/%s, esperaba %s/analitica", rows[0].UserID, rows[0].Plan, victorID)
	}
	if rows[1].UserID != f.userID || rows[1].Plan != "plus" {
		t.Fatalf("segunda fila: %s/%s, esperaba %s/plus", rows[1].UserID, rows[1].Plan, f.userID)
	}

	v := rows[0]
	if v.FirstName != "Victor" || v.LastName != "Lobo" {
		t.Fatalf("nombre inesperado: %q %q", v.FirstName, v.LastName)
	}
	if strings.Contains(v.CedulaMasked, victorCedula) || !strings.HasSuffix(v.CedulaMasked, "321") {
		t.Fatalf("cedula_masked inesperado: %q", v.CedulaMasked)
	}
	if strings.Contains(v.PhoneMasked, victorPhone) || !strings.HasSuffix(v.PhoneMasked, "5678") {
		t.Fatalf("phone_masked inesperado: %q", v.PhoneMasked)
	}
	if v.EmailMasked == victorEmail || strings.Contains(v.EmailMasked, "victor@") {
		t.Fatalf("email_masked expone la parte local: %q", v.EmailMasked)
	}
	if !strings.HasPrefix(v.EmailMasked, "v") || !strings.HasSuffix(v.EmailMasked, "@example.com") {
		t.Fatalf("email_masked inesperado: %q", v.EmailMasked)
	}
}

func TestAudit_GuardaElPlanYNadaDePII(t *testing.T) {
	f := setup(t, nil)
	pool := f.pool
	ctx := context.Background()

	logger := audit.NewLogger(audit.NewRepository(pool), 10)
	svc := plans.NewService(pool, &plans.Options{AuditLogger: logger})
	if _, err := svc.Register(ctx, victorID, "pro", actor); err != nil {
		t.Fatalf("Register() error: %v", err)
	}
	logger.Stop() // vacia el buffer a la tabla

	var risk, plan, details, actorID string
	if err := pool.QueryRow(ctx,
		`SELECT risk_level, details->>'plan', details::text, user_id::text
		   FROM audit_logs WHERE action = 'plan_interest'`,
	).Scan(&risk, &plan, &details, &actorID); err != nil {
		t.Fatalf("leer auditoria: %v", err)
	}
	if risk != "low" || plan != "pro" || actorID != victorID {
		t.Fatalf("rastro inesperado: risk=%s plan=%s actor=%s", risk, plan, actorID)
	}
	// details es JSONB sin cifrar: ni nombre, ni correo, ni telefono.
	if bajo := strings.ToLower(details); strings.Contains(bajo, "victor") ||
		strings.Contains(details, "@") || strings.Contains(details, victorPhone) {
		t.Fatalf("la auditoria expone PII: %s", details)
	}
}

// ── Plan asignado por un administrador ──────────────────────────────────────

func TestAsignarPlan_AuditaConRiesgoAlto_YNoCobra(t *testing.T) {
	f := setup(t, nil)
	ctx := context.Background()
	logger := audit.NewLogger(audit.NewRepository(f.pool), 10)
	svc := plans.NewService(f.pool, &plans.Options{AuditLogger: logger})

	got, err := svc.AsignarPlan(ctx, victorID, f.adminID, "pro", actor)
	if err != nil {
		t.Fatalf("AsignarPlan(pro): %v", err)
	}
	if got.UserID != victorID || got.Plan != "pro" || got.PlanAnterior != "free" {
		t.Fatalf("respuesta inesperada: %+v", got)
	}
	// Bajar de plan tambien queda en el rastro, con el plan de donde viene.
	bajada, err := svc.AsignarPlan(ctx, victorID, f.adminID, "free", actor)
	if err != nil {
		t.Fatalf("AsignarPlan(free): %v", err)
	}
	if bajada.PlanAnterior != "pro" || bajada.Plan != "free" {
		t.Fatalf("bajada inesperada: %+v", bajada)
	}
	logger.Stop()

	var n int
	if err := f.pool.QueryRow(ctx,
		`SELECT count(*) FROM audit_logs WHERE action = 'admin_user_plan_set'`).Scan(&n); err != nil {
		t.Fatalf("contar auditoria: %v", err)
	}
	if n != 2 {
		t.Fatalf("filas de auditoria = %d, esperaba 2", n)
	}
	var risk, actorID, recurso, anterior, cobro string
	if err := f.pool.QueryRow(ctx,
		`SELECT risk_level, user_id::text, resource_id, details->>'plan_anterior', details->>'cobro'
		   FROM audit_logs
		  WHERE action = 'admin_user_plan_set' AND details->>'plan_nuevo' = 'pro'`,
	).Scan(&risk, &actorID, &recurso, &anterior, &cobro); err != nil {
		t.Fatalf("leer auditoria: %v", err)
	}
	if risk != "high" || actorID != f.adminID || recurso != victorID || anterior != "free" || cobro != "false" {
		t.Fatalf("rastro inesperado: risk=%s actor=%s recurso=%s anterior=%s cobro=%s",
			risk, actorID, recurso, anterior, cobro)
	}
}

func TestAsignarPlan_PorHTTP_CambiaLoQueLeeLaCuenta(t *testing.T) {
	f := setup(t, nil)
	router := newRouter(plans.NewHandler(f.svc), f.userRepo, f.adminID)

	status, env := do(t, router, http.MethodPatch, "/admin/users/"+victorID+"/plan", `{"plan":"plus"}`)
	if status != http.StatusOK || !env.Success {
		t.Fatalf("asignar plan: %d %s", status, string(env.Data))
	}
	var got plans.PlanAsignado
	if err := json.Unmarshal(env.Data, &got); err != nil {
		t.Fatalf("data no es un plan asignado: %v", err)
	}
	if got.UserID != victorID || got.Plan != "plus" || got.PlanAnterior != "free" || got.UpdatedAt.IsZero() {
		t.Fatalf("respuesta inesperada: %+v", got)
	}
	if p := f.planDe(t, victorID); p != "plus" {
		t.Fatalf("plan en la base = %q, esperaba plus", p)
	}
	// /users/me y el login leen el plan con FindByID.
	u, err := f.userRepo.FindByID(context.Background(), victorID)
	if err != nil || u.Plan != "plus" {
		t.Fatalf("FindByID: plan=%q err=%v, esperaba plus", u.Plan, err)
	}
}

func TestAsignarPlan_ValidacionEstricta(t *testing.T) {
	f := setup(t, nil)
	router := newRouter(plans.NewHandler(f.svc), f.userRepo, f.adminID)
	ruta := "/admin/users/" + victorID + "/plan"

	casos := []struct {
		nombre, ruta, cuerpo string
		status               int
		codigo               string
	}{
		{"plan en mayusculas", ruta, `{"plan":"PRO"}`, http.StatusBadRequest, "PLAN_INVALID"},
		{"plan desconocido", ruta, `{"plan":"gold"}`, http.StatusBadRequest, "PLAN_INVALID"},
		{"plan de comercio", ruta, `{"plan":"analitica"}`, http.StatusBadRequest, "PLAN_INVALID"},
		{"plan con espacio", ruta, `{"plan":" pro"}`, http.StatusBadRequest, "PLAN_INVALID"},
		{"sin plan", ruta, `{}`, http.StatusBadRequest, "PLAN_INVALID"},
		{"plan null", ruta, `{"plan":null}`, http.StatusBadRequest, "PLAN_INVALID"},
		{"sin cuerpo", ruta, "", http.StatusBadRequest, "PLAN_INVALID"},
		{"campo de mas", ruta, `{"plan":"pro","hasta":"2027-01-01"}`, http.StatusBadRequest, "INVALID_BODY"},
		{"dos objetos", ruta, `{"plan":"pro"}{"plan":"free"}`, http.StatusBadRequest, "INVALID_BODY"},
		{"json roto", ruta, `{"plan":`, http.StatusBadRequest, "INVALID_BODY"},
		{"plan no es texto", ruta, `{"plan":1}`, http.StatusBadRequest, "INVALID_BODY"},
		{"id no es uuid", "/admin/users/abc/plan", `{"plan":"pro"}`, http.StatusBadRequest, "INVALID_ID"},
		{"cuenta inexistente", "/admin/users/00000000-0000-0000-0000-0000000000ff/plan", `{"plan":"pro"}`,
			http.StatusNotFound, "USER_NOT_FOUND"},
	}
	for _, c := range casos {
		status, env := do(t, router, http.MethodPatch, c.ruta, c.cuerpo)
		if status != c.status || errorCode(env) != c.codigo {
			t.Errorf("%s: %d %s, esperaba %d %s", c.nombre, status, errorCode(env), c.status, c.codigo)
		}
	}
	if p := f.planDe(t, victorID); p != "free" {
		t.Fatalf("un cuerpo rechazado cambio el plan a %q", p)
	}
}

// ── Handler + RequireAdmin ──────────────────────────────────────────────────

// newRouter monta los handlers como main.go: el registro dentro del grupo
// autenticado y las rutas de administrador dentro de RequireAdmin, con el
// actor ya en contexto.
func newRouter(h *plans.Handler, userRepo *user.Repository, actorID string) http.Handler {
	r := chi.NewRouter()
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			ctx := context.WithValue(req.Context(), middleware.UserIDKey, actorID)
			next.ServeHTTP(w, req.WithContext(ctx))
		})
	})
	r.Post("/plans/interest", h.RegisterInterest)
	r.Group(func(r chi.Router) {
		r.Use(middleware.RequireAdmin(userRepo))
		r.Get("/admin/plans/interest", h.List)
		r.Patch("/admin/users/{id}/plan", h.AsignarPlan)
	})
	return r
}

type envelope struct {
	Success bool            `json:"success"`
	Data    json.RawMessage `json:"data"`
	Error   *struct {
		Code string `json:"code"`
	} `json:"error"`
}

func do(t *testing.T, router http.Handler, method, target, body string) (int, envelope) {
	t.Helper()
	req := httptest.NewRequest(method, target, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	var env envelope
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("la respuesta no es JSON (%d): %s", rec.Code, rec.Body.String())
	}
	return rec.Code, env
}

func errorCode(env envelope) string {
	if env.Error == nil {
		return ""
	}
	return env.Error.Code
}

func TestHandler_RegistraYListaComoAdmin(t *testing.T) {
	f := setup(t, nil)
	h := plans.NewHandler(f.svc)

	status, env := do(t, newRouter(h, f.userRepo, f.userID), http.MethodPost, "/plans/interest", `{"plan":"plus"}`)
	if status != http.StatusOK || !env.Success {
		t.Fatalf("interes: %d %s", status, string(env.Data))
	}
	var got plans.Interest
	if err := json.Unmarshal(env.Data, &got); err != nil {
		t.Fatalf("data no es un interes: %v", err)
	}
	if got.Plan != "plus" || got.RegisteredAt.IsZero() {
		t.Fatalf("respuesta inesperada: %+v", got)
	}
	if !strings.Contains(string(env.Data), `"registered_at"`) {
		t.Fatalf("el JSON no lleva registered_at en snake_case: %s", string(env.Data))
	}

	status, env = do(t, newRouter(h, f.userRepo, f.adminID), http.MethodGet, "/admin/plans/interest", "")
	if status != http.StatusOK || !strings.Contains(string(env.Data), f.userID) {
		t.Fatalf("lista admin: %d %s", status, string(env.Data))
	}
	// El seed 1 tiene telefono +50688881234: la lista solo debe traer el final.
	if strings.Contains(string(env.Data), "88881234") {
		t.Fatalf("la lista admin expone el telefono completo: %s", string(env.Data))
	}
}

func TestHandler_PlanInvalidoDa400(t *testing.T) {
	f := setup(t, nil)
	router := newRouter(plans.NewHandler(f.svc), f.userRepo, f.userID)

	cases := []struct{ name, body string }{
		{"plan desconocido", `{"plan":"premium"}`},
		{"plan retirado", `{"plan":"negocio"}`},
		{"plan vacio", `{"plan":""}`},
		{"sin plan", `{}`},
		{"sin cuerpo", ""},
	}
	for _, c := range cases {
		status, env := do(t, router, http.MethodPost, "/plans/interest", c.body)
		if status != http.StatusBadRequest || errorCode(env) != "PLAN_INVALID" {
			t.Errorf("%s: %d %s, esperaba 400 PLAN_INVALID", c.name, status, errorCode(env))
		}
	}

	status, env := do(t, router, http.MethodPost, "/plans/interest", `{"plan":`)
	if status != http.StatusBadRequest || errorCode(env) != "INVALID_BODY" {
		t.Fatalf("json roto: %d %s, esperaba 400 INVALID_BODY", status, errorCode(env))
	}
}

func TestHandler_NoAdminRecibe403(t *testing.T) {
	f := setup(t, nil)
	router := newRouter(plans.NewHandler(f.svc), f.userRepo, f.userID)

	status, env := do(t, router, http.MethodGet, "/admin/plans/interest", "")
	if status != http.StatusForbidden || errorCode(env) != "FORBIDDEN" {
		t.Fatalf("no admin: %d %s, esperaba 403 FORBIDDEN", status, errorCode(env))
	}

	// Una persona no se puede subir el plan a si misma.
	status, env = do(t, router, http.MethodPatch, "/admin/users/"+f.userID+"/plan", `{"plan":"pro"}`)
	if status != http.StatusForbidden || errorCode(env) != "FORBIDDEN" {
		t.Fatalf("no admin asignando plan: %d %s, esperaba 403 FORBIDDEN", status, errorCode(env))
	}
	if p := f.planDe(t, f.userID); p != "free" {
		t.Fatalf("un no administrador cambio su plan a %q", p)
	}
}
