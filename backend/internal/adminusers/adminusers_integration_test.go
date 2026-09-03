package adminusers_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kiramopay/backend/internal/adminusers"
	"github.com/kiramopay/backend/internal/audit"
	"github.com/kiramopay/backend/internal/auth"
	"github.com/kiramopay/backend/internal/middleware"
	"github.com/kiramopay/backend/internal/testutil"
	"github.com/kiramopay/backend/internal/user"
	"github.com/kiramopay/backend/pkg/hash"
)

// Tercer usuario con correo y nombre propio, fuera de los seeds fijos
// (...-0001 / ...-0002) para no chocar con otros paquetes bajo -p 1.
const (
	keilorID     = "00000000-0000-0000-0000-0000000000a3"
	keilorCedula = "123456789"
	keilorPhone  = "+50670001234"
	keilorEmail  = "keilor@example.com"
	sinCuentaID  = "00000000-0000-0000-0000-0000000000ff"
)

type fixture struct {
	svc      *adminusers.Service
	pool     *pgxpool.Pool
	authRepo *auth.Repository
	userRepo *user.Repository
	userID   string // seed 1: Test User, role user
	adminID  string // seed 2: Admin User, role admin
}

func setup(t *testing.T, opts *adminusers.Options) *fixture {
	t.Helper()
	pool := testutil.TestDB(t)
	rdb := testutil.TestRedis(t)
	authRepo := auth.NewRepository(pool, rdb)
	userRepo := user.NewRepository(pool)

	pinHash, _ := hash.HashPin("Kiramopay2024!")
	userID := testutil.SeedTestUser(t, pool, "702650930", pinHash)
	adminID := testutil.SeedTestUser2(t, pool)
	seedKeilor(t, pool)

	return &fixture{
		svc:      adminusers.NewService(userRepo, authRepo, opts),
		pool:     pool,
		authRepo: authRepo,
		userRepo: userRepo,
		userID:   userID,
		adminID:  adminID,
	}
}

func seedKeilor(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO users (id, cedula_enc, cedula_hash, phone_enc, phone_hash, email_enc, email_hash,
		        first_name, last_name, password_hash, status, kyc_level)
		 VALUES ($1, fn_pii_encrypt($2), fn_pii_hmac($2), fn_pii_encrypt($3), fn_pii_hmac($3),
		         fn_pii_encrypt($4), fn_pii_hmac($4), 'Keilor', 'Martinez', 'dummy_hash', 'active', 1)
		 ON CONFLICT (id) DO NOTHING`,
		keilorID, keilorCedula, keilorPhone, keilorEmail,
	); err != nil {
		t.Fatalf("seed keilor: %v", err)
	}
}

var actor = adminusers.ActorContext{IPAddress: "127.0.0.1", UserAgent: "test"}

// soloUno busca el termino y exige exactamente un resultado con el id dado.
func (f *fixture) soloUno(t *testing.T, term, wantID string) user.AdminUserView {
	t.Helper()
	views, err := f.svc.Search(context.Background(), term, 0, f.adminID, actor)
	if err != nil {
		t.Fatalf("Search(%q) error: %v", term, err)
	}
	if len(views) != 1 {
		t.Fatalf("Search(%q): esperaba 1 resultado, hubo %d", term, len(views))
	}
	if views[0].ID != wantID {
		t.Fatalf("Search(%q): resultado %s, esperaba %s", term, views[0].ID, wantID)
	}
	return views[0]
}

func TestSearch_PorCedulaTelefonoYCorreo_EnmascaraLaPII(t *testing.T) {
	f := setup(t, nil)

	// Cedula con guiones: Classify la canonicaliza a solo digitos antes del HMAC.
	v := f.soloUno(t, "1-2345-6789", keilorID)
	if strings.Contains(v.CedulaMasked, keilorCedula) {
		t.Fatalf("cedula_masked expone la cedula completa: %q", v.CedulaMasked)
	}
	if !strings.HasSuffix(v.CedulaMasked, "789") {
		t.Fatalf("cedula_masked debia terminar en los ultimos 3 digitos: %q", v.CedulaMasked)
	}
	if v.FirstName != "Keilor" || v.LastName != "Martinez" {
		t.Fatalf("nombre inesperado: %q %q", v.FirstName, v.LastName)
	}
	if v.Status != "active" || v.Role != "user" {
		t.Fatalf("status/role inesperados: %s/%s", v.Status, v.Role)
	}

	// Telefono tecleado sin +506: canonico +50670001234.
	v = f.soloUno(t, "7000-1234", keilorID)
	if strings.Contains(v.PhoneMasked, keilorPhone) || !strings.HasSuffix(v.PhoneMasked, "1234") {
		t.Fatalf("phone_masked inesperado: %q", v.PhoneMasked)
	}

	// Correo con mayusculas: canonico lower(trim).
	v = f.soloUno(t, "  Keilor@Example.COM ", keilorID)
	if v.EmailMasked == keilorEmail || !strings.HasPrefix(v.EmailMasked, "k") || !strings.HasSuffix(v.EmailMasked, "@example.com") {
		t.Fatalf("email_masked inesperado: %q", v.EmailMasked)
	}
	if strings.Contains(v.EmailMasked, "keilor@") {
		t.Fatalf("email_masked expone la parte local completa: %q", v.EmailMasked)
	}
}

func TestSearch_PorNombreParcial(t *testing.T) {
	f := setup(t, nil)
	ctx := context.Background()

	views, err := f.svc.Search(ctx, "keil", 0, f.adminID, actor)
	if err != nil {
		t.Fatalf("Search() error: %v", err)
	}
	if len(views) != 1 || views[0].ID != keilorID {
		t.Fatalf("esperaba solo a Keilor, hubo %d resultados", len(views))
	}

	// Nombre y apellido juntos: la busqueda concatena first_name || ' ' || last_name.
	views, err = f.svc.Search(ctx, "keilor mart", 0, f.adminID, actor)
	if err != nil || len(views) != 1 {
		t.Fatalf("busqueda por nombre completo: err=%v n=%d", err, len(views))
	}

	// Un identificador que clasifica pero no existe no cae al ILIKE por nombre.
	views, err = f.svc.Search(ctx, "999999999", 0, f.adminID, actor)
	if err != nil || len(views) != 0 {
		t.Fatalf("cedula inexistente: err=%v n=%d", err, len(views))
	}
}

func TestSearch_ComodinesEscapados_NoListanTodo(t *testing.T) {
	f := setup(t, nil)
	ctx := context.Background()

	for _, term := range []string{"%%%", "___", `\\\`, "%a%"} {
		views, err := f.svc.Search(ctx, term, 0, f.adminID, actor)
		if err != nil {
			t.Fatalf("Search(%q) error: %v", term, err)
		}
		if len(views) != 0 {
			t.Fatalf("Search(%q) devolvio %d cuentas: el comodin no se escapo", term, len(views))
		}
	}
}

func TestSearch_TerminoCorto(t *testing.T) {
	f := setup(t, nil)
	ctx := context.Background()

	for _, term := range []string{"", "ke", "  k  ", " ab "} {
		if _, err := f.svc.Search(ctx, term, 0, f.adminID, actor); !errors.Is(err, adminusers.ErrTermTooShort) {
			t.Fatalf("Search(%q) = %v, esperaba ErrTermTooShort", term, err)
		}
	}
}

func TestBlock_MotivoObligatorio(t *testing.T) {
	f := setup(t, nil)
	ctx := context.Background()

	for _, reason := range []string{"", "   ", strings.Repeat("x", 501)} {
		if _, err := f.svc.Block(ctx, f.userID, f.adminID, reason, actor); !errors.Is(err, adminusers.ErrReasonRequired) {
			t.Fatalf("Block(reason len %d) = %v, esperaba ErrReasonRequired", len(reason), err)
		}
	}
	var status string
	if err := f.pool.QueryRow(ctx, `SELECT status FROM users WHERE id = $1::uuid`, f.userID).Scan(&status); err != nil {
		t.Fatalf("leer status: %v", err)
	}
	if status != "active" {
		t.Fatalf("un motivo invalido no debia bloquear: status=%s", status)
	}
}

func TestBlock_ASiMismo(t *testing.T) {
	f := setup(t, nil)
	if _, err := f.svc.Block(context.Background(), f.adminID, f.adminID, "me equivoque", actor); !errors.Is(err, adminusers.ErrSelfBlock) {
		t.Fatalf("Block(self) = %v, esperaba ErrSelfBlock", err)
	}
}

func TestBlock_AOtroAdmin(t *testing.T) {
	f := setup(t, nil)
	// El seed 2 es role='admin'; el actor es cualquier otra cuenta.
	if _, err := f.svc.Block(context.Background(), f.adminID, f.userID, "motivo", actor); !errors.Is(err, adminusers.ErrAdminTarget) {
		t.Fatalf("Block(admin) = %v, esperaba ErrAdminTarget", err)
	}
}

func TestBlock_UsuarioInexistente(t *testing.T) {
	f := setup(t, nil)
	ctx := context.Background()

	if _, err := f.svc.Block(ctx, sinCuentaID, f.adminID, "motivo", actor); !errors.Is(err, adminusers.ErrNotFound) {
		t.Fatalf("Block(inexistente) = %v, esperaba ErrNotFound", err)
	}
	if _, err := f.svc.Unblock(ctx, sinCuentaID, f.adminID, actor); !errors.Is(err, adminusers.ErrNotFound) {
		t.Fatalf("Unblock(inexistente) = %v, esperaba ErrNotFound", err)
	}
	if _, err := f.svc.Get(ctx, sinCuentaID); !errors.Is(err, adminusers.ErrNotFound) {
		t.Fatalf("Get(inexistente) = %v, esperaba ErrNotFound", err)
	}
}

func TestBlock_IdaYVueltaConListBlocked(t *testing.T) {
	f := setup(t, nil)
	ctx := context.Background()

	blocked, err := f.svc.ListBlocked(ctx, 0)
	if err != nil || len(blocked) != 0 {
		t.Fatalf("ListBlocked inicial: err=%v n=%d", err, len(blocked))
	}

	v, err := f.svc.Block(ctx, f.userID, f.adminID, "Demo prestada, acceso revocado", actor)
	if err != nil {
		t.Fatalf("Block() error: %v", err)
	}
	if v.Status != "blocked" || v.BlockedAt == nil {
		t.Fatalf("la ficha no refleja el bloqueo: status=%s blocked_at=%v", v.Status, v.BlockedAt)
	}
	if v.BlockedReason != "Demo prestada, acceso revocado" {
		t.Fatalf("blocked_reason = %q", v.BlockedReason)
	}
	if v.BlockedByName != "Admin User" {
		t.Fatalf("blocked_by_name = %q, esperaba el nombre del admin", v.BlockedByName)
	}
	if isBlocked, err := f.authRepo.IsUserBlocked(ctx, f.userID); err != nil || !isBlocked {
		t.Fatalf("la marca en Redis no quedo puesta: blocked=%v err=%v", isBlocked, err)
	}

	// Idempotente: repetir no falla ni cambia el estado.
	if _, err := f.svc.Block(ctx, f.userID, f.adminID, "otra vez", actor); err != nil {
		t.Fatalf("segundo Block() error: %v", err)
	}

	blocked, err = f.svc.ListBlocked(ctx, 0)
	if err != nil {
		t.Fatalf("ListBlocked() error: %v", err)
	}
	if len(blocked) != 1 || blocked[0].ID != f.userID {
		t.Fatalf("ListBlocked debia traer solo la cuenta bloqueada, trajo %d", len(blocked))
	}

	v, err = f.svc.Unblock(ctx, f.userID, f.adminID, actor)
	if err != nil {
		t.Fatalf("Unblock() error: %v", err)
	}
	if v.Status != "active" || v.BlockedAt != nil || v.BlockedReason != "" || v.BlockedByName != "" {
		t.Fatalf("la ficha no refleja el desbloqueo: %+v", v)
	}
	if isBlocked, err := f.authRepo.IsUserBlocked(ctx, f.userID); err != nil || isBlocked {
		t.Fatalf("la marca en Redis no se quito: blocked=%v err=%v", isBlocked, err)
	}
	blocked, err = f.svc.ListBlocked(ctx, 0)
	if err != nil || len(blocked) != 0 {
		t.Fatalf("ListBlocked tras desbloquear: err=%v n=%d", err, len(blocked))
	}
}

func TestBlock_DejaRastroEnAuditoriaSinPII(t *testing.T) {
	pool := testutil.TestDB(t)
	logger := audit.NewLogger(audit.NewRepository(pool), 10)
	rdb := testutil.TestRedis(t)
	authRepo := auth.NewRepository(pool, rdb)
	userRepo := user.NewRepository(pool)
	pinHash, _ := hash.HashPin("Kiramopay2024!")
	userID := testutil.SeedTestUser(t, pool, "702650930", pinHash)
	adminID := testutil.SeedTestUser2(t, pool)
	seedKeilor(t, pool)
	svc := adminusers.NewService(userRepo, authRepo, &adminusers.Options{AuditLogger: logger})
	ctx := context.Background()

	if _, err := svc.Search(ctx, keilorEmail, 0, adminID, actor); err != nil {
		t.Fatalf("Search() error: %v", err)
	}
	if _, err := svc.Block(ctx, userID, adminID, "presto la demo", actor); err != nil {
		t.Fatalf("Block() error: %v", err)
	}
	if _, err := svc.Unblock(ctx, userID, adminID, actor); err != nil {
		t.Fatalf("Unblock() error: %v", err)
	}
	logger.Stop() // vacia el buffer a la tabla

	var action, risk, reason, actorID string
	if err := pool.QueryRow(ctx,
		`SELECT action, risk_level, details->>'reason', user_id::text FROM audit_logs
		 WHERE resource_id = $1 AND action = 'user_blocked'`, userID,
	).Scan(&action, &risk, &reason, &actorID); err != nil {
		t.Fatalf("leer auditoria del bloqueo: %v", err)
	}
	if action != "user_blocked" || risk != "critical" || reason != "presto la demo" || actorID != adminID {
		t.Fatalf("rastro inesperado: action=%s risk=%s reason=%q actor=%s", action, risk, reason, actorID)
	}

	var n int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM audit_logs WHERE resource_id = $1 AND action = 'user_unblocked' AND risk_level = 'high'`, userID,
	).Scan(&n); err != nil || n != 1 {
		t.Fatalf("rastro del desbloqueo: n=%d err=%v", n, err)
	}

	// La busqueda guarda el TIPO y el conteo, jamas el termino (details es JSONB sin cifrar).
	var kind, details string
	if err := pool.QueryRow(ctx,
		`SELECT details->>'kind', details::text FROM audit_logs WHERE action = 'admin_user_search'`,
	).Scan(&kind, &details); err != nil {
		t.Fatalf("leer auditoria de la busqueda: %v", err)
	}
	if kind != "email" {
		t.Fatalf("kind = %q, esperaba email", kind)
	}
	if strings.Contains(strings.ToLower(details), "keilor") || strings.Contains(details, "@") {
		t.Fatalf("la auditoria de busqueda expone el termino: %s", details)
	}
}

// ── Handler + RequireAdmin ──────────────────────────────────────────────────

// newRouter monta los handlers detras de RequireAdmin con el actor dado ya en
// contexto, igual que el grupo admin de main.go tras el middleware de auth.
func newRouter(h *adminusers.Handler, userRepo *user.Repository, actorID string) http.Handler {
	r := chi.NewRouter()
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			ctx := context.WithValue(req.Context(), middleware.UserIDKey, actorID)
			next.ServeHTTP(w, req.WithContext(ctx))
		})
	})
	r.Group(func(r chi.Router) {
		r.Use(middleware.RequireAdmin(userRepo))
		r.Post("/admin/users/search", h.Search)
		r.Get("/admin/users/blocked", h.ListBlocked)
		r.Get("/admin/users/{id}", h.Get)
		r.Post("/admin/users/{id}/block", h.Block)
		r.Post("/admin/users/{id}/unblock", h.Unblock)
		r.Post("/admin/users/{id}/expiry", h.SetExpiry)
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

func TestHandler_NoAdminRecibe403(t *testing.T) {
	f := setup(t, nil)
	router := newRouter(adminusers.NewHandler(f.svc), f.userRepo, f.userID)

	status, env := do(t, router, http.MethodPost, "/admin/users/"+keilorID+"/block", `{"reason":"x"}`)
	if status != http.StatusForbidden || errorCode(env) != "FORBIDDEN" {
		t.Fatalf("no admin: %d %s, esperaba 403 FORBIDDEN", status, errorCode(env))
	}
	status, env = do(t, router, http.MethodPost, "/admin/users/search", `{"q":"keil"}`)
	if status != http.StatusForbidden || errorCode(env) != "FORBIDDEN" {
		t.Fatalf("no admin (search): %d %s, esperaba 403 FORBIDDEN", status, errorCode(env))
	}
}

func TestHandler_AdminBloqueaYDesbloquea(t *testing.T) {
	f := setup(t, nil)
	router := newRouter(adminusers.NewHandler(f.svc), f.userRepo, f.adminID)

	status, env := do(t, router, http.MethodPost, "/admin/users/"+f.userID+"/block", `{"reason":"presto la demo"}`)
	if status != http.StatusOK || !env.Success {
		t.Fatalf("block: %d %s", status, string(env.Data))
	}
	var v user.AdminUserView
	if err := json.Unmarshal(env.Data, &v); err != nil {
		t.Fatalf("data no es una ficha: %v", err)
	}
	if v.Status != "blocked" || v.BlockedReason != "presto la demo" {
		t.Fatalf("ficha tras bloquear: status=%s reason=%q", v.Status, v.BlockedReason)
	}
	if !strings.Contains(string(env.Data), `"status":"blocked"`) {
		t.Fatalf("el JSON no lleva status blocked en snake_case: %s", string(env.Data))
	}

	status, env = do(t, router, http.MethodGet, "/admin/users/blocked", "")
	if status != http.StatusOK || !strings.Contains(string(env.Data), f.userID) {
		t.Fatalf("blocked list: %d %s", status, string(env.Data))
	}

	status, env = do(t, router, http.MethodPost, "/admin/users/"+f.userID+"/unblock", "")
	if status != http.StatusOK || !strings.Contains(string(env.Data), `"status":"active"`) {
		t.Fatalf("unblock: %d %s", status, string(env.Data))
	}
}

func TestHandler_CodigosDeError(t *testing.T) {
	f := setup(t, nil)
	router := newRouter(adminusers.NewHandler(f.svc), f.userRepo, f.adminID)

	cases := []struct {
		name, method, target, body, code string
		status                           int
	}{
		{"id invalido", http.MethodGet, "/admin/users/not-a-uuid", "", "INVALID_ID", http.StatusBadRequest},
		{"id invalido en block", http.MethodPost, "/admin/users/123/block", `{"reason":"x"}`, "INVALID_ID", http.StatusBadRequest},
		{"inexistente", http.MethodGet, "/admin/users/" + sinCuentaID, "", "USER_NOT_FOUND", http.StatusNotFound},
		{"termino corto", http.MethodPost, "/admin/users/search", `{"q":"ke"}`, "SEARCH_TERM_TOO_SHORT", http.StatusBadRequest},
		{"sin motivo", http.MethodPost, "/admin/users/" + f.userID + "/block", `{"reason":"  "}`, "REASON_REQUIRED", http.StatusBadRequest},
		{"sin cuerpo", http.MethodPost, "/admin/users/" + f.userID + "/block", "", "REASON_REQUIRED", http.StatusBadRequest},
		{"a si mismo", http.MethodPost, "/admin/users/" + f.adminID + "/block", `{"reason":"x"}`, "CANNOT_BLOCK_SELF", http.StatusBadRequest},
		{"bloquear inexistente", http.MethodPost, "/admin/users/" + sinCuentaID + "/block", `{"reason":"x"}`, "USER_NOT_FOUND", http.StatusNotFound},
	}
	for _, c := range cases {
		status, env := do(t, router, c.method, c.target, c.body)
		if status != c.status || errorCode(env) != c.code {
			t.Errorf("%s: %d %s, esperaba %d %s", c.name, status, errorCode(env), c.status, c.code)
		}
	}
}

func TestHandler_OtroAdminNoSePuedeBloquear(t *testing.T) {
	f := setup(t, nil)
	// Un segundo administrador que intenta bloquear al seed admin.
	segundoAdmin := "00000000-0000-0000-0000-0000000000a4"
	if _, err := f.pool.Exec(context.Background(),
		`INSERT INTO users (id, cedula_enc, cedula_hash, phone_enc, phone_hash, first_name, last_name, password_hash, status, kyc_level, role)
		 VALUES ($1, fn_pii_encrypt('111111111'), fn_pii_hmac('111111111'), fn_pii_encrypt('+50670009999'), fn_pii_hmac('+50670009999'),
		         'Segundo', 'Admin', 'dummy_hash', 'active', 1, 'admin')`, segundoAdmin,
	); err != nil {
		t.Fatalf("seed segundo admin: %v", err)
	}
	router := newRouter(adminusers.NewHandler(f.svc), f.userRepo, segundoAdmin)

	status, env := do(t, router, http.MethodPost, "/admin/users/"+f.adminID+"/block", `{"reason":"x"}`)
	if status != http.StatusBadRequest || errorCode(env) != "CANNOT_BLOCK_ADMIN" {
		t.Fatalf("bloquear admin: %d %s, esperaba 400 CANNOT_BLOCK_ADMIN", status, errorCode(env))
	}
}
