package plans_test

import (
	"context"
	"encoding/json"
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

func TestRegister_AnotaElInteres(t *testing.T) {
	f := setup(t, nil)

	got, err := f.svc.Register(context.Background(), victorID, "negocio", actor)
	if err != nil {
		t.Fatalf("Register() error: %v", err)
	}
	if got.Plan != "negocio" {
		t.Fatalf("plan = %q, esperaba negocio", got.Plan)
	}
	if time.Since(got.RegisteredAt) > time.Minute {
		t.Fatalf("registered_at fuera de rango: %v", got.RegisteredAt)
	}
	if n := f.filas(t, victorID); n != 1 {
		t.Fatalf("filas = %d, esperaba 1", n)
	}
}

func TestRegister_DosVeces_UnaSolaFilaConFechaNueva(t *testing.T) {
	f := setup(t, nil)
	ctx := context.Background()

	primero, err := f.svc.Register(ctx, victorID, "cima", actor)
	if err != nil {
		t.Fatalf("primer Register() error: %v", err)
	}
	// Sin esta pausa las dos marcas de tiempo pueden caer en el mismo
	// microsegundo y la comparacion de abajo no probaria nada.
	time.Sleep(5 * time.Millisecond)

	segundo, err := f.svc.Register(ctx, victorID, "cima", actor)
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
	if _, err := f.svc.Register(ctx, victorID, "negocio", actor); err != nil {
		t.Fatalf("Register(negocio) error: %v", err)
	}
	if n := f.filas(t, victorID); n != 2 {
		t.Fatalf("filas = %d, esperaba 2 (un plan distinto es otra fila)", n)
	}
}

func TestRegister_PlanInvalido(t *testing.T) {
	f := setup(t, nil)
	ctx := context.Background()

	for _, plan := range []string{"", "free", "gratis", "NEGOCIO", "premium"} {
		if _, err := f.svc.Register(ctx, victorID, plan, actor); err == nil {
			t.Errorf("Register(%q) no dio error, esperaba ErrPlanInvalid", plan)
		}
	}
	if n := f.filas(t, victorID); n != 0 {
		t.Fatalf("filas = %d, esperaba 0: un plan invalido no debe escribir nada", n)
	}
}

func TestList_EnmascaraLaPII_YOrdenaPorFecha(t *testing.T) {
	f := setup(t, nil)
	ctx := context.Background()

	if _, err := f.svc.Register(ctx, f.userID, "negocio", actor); err != nil {
		t.Fatalf("Register(userID) error: %v", err)
	}
	time.Sleep(5 * time.Millisecond)
	if _, err := f.svc.Register(ctx, victorID, "cima", actor); err != nil {
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
	if rows[0].UserID != victorID || rows[0].Plan != "cima" {
		t.Fatalf("primera fila: %s/%s, esperaba %s/cima", rows[0].UserID, rows[0].Plan, victorID)
	}
	if rows[1].UserID != f.userID || rows[1].Plan != "negocio" {
		t.Fatalf("segunda fila: %s/%s, esperaba %s/negocio", rows[1].UserID, rows[1].Plan, f.userID)
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
	if _, err := svc.Register(ctx, victorID, "cima", actor); err != nil {
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
	if risk != "low" || plan != "cima" || actorID != victorID {
		t.Fatalf("rastro inesperado: risk=%s plan=%s actor=%s", risk, plan, actorID)
	}
	// details es JSONB sin cifrar: ni nombre, ni correo, ni telefono.
	if bajo := strings.ToLower(details); strings.Contains(bajo, "victor") ||
		strings.Contains(details, "@") || strings.Contains(details, victorPhone) {
		t.Fatalf("la auditoria expone PII: %s", details)
	}
}

// ── Handler + RequireAdmin ──────────────────────────────────────────────────

// newRouter monta los handlers como main.go: el registro dentro del grupo
// autenticado y la lista dentro de RequireAdmin, con el actor ya en contexto.
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

	status, env := do(t, newRouter(h, f.userRepo, f.userID), http.MethodPost, "/plans/interest", `{"plan":"negocio"}`)
	if status != http.StatusOK || !env.Success {
		t.Fatalf("interes: %d %s", status, string(env.Data))
	}
	var got plans.Interest
	if err := json.Unmarshal(env.Data, &got); err != nil {
		t.Fatalf("data no es un interes: %v", err)
	}
	if got.Plan != "negocio" || got.RegisteredAt.IsZero() {
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
}
