package auth_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/kiramopay/backend/internal/auth"
	"github.com/kiramopay/backend/internal/middleware"
	"github.com/kiramopay/backend/internal/testutil"
	"github.com/kiramopay/backend/internal/user"
	"github.com/kiramopay/backend/internal/wallet"
	jwtpkg "github.com/kiramopay/backend/pkg/jwt"
	goredis "github.com/redis/go-redis/v9"
)

// ─────────────────────────────────────────────────────────────────────────
//  Bloqueo remoto de cuentas
//
//  El bloqueo tiene que ser efectivo en la siguiente peticion aunque Redis
//  este caido (la BD es la autoridad), distinguible del cierre de sesion
//  normal cuando Redis esta, y reversible sin resucitar sesiones viejas.
//  Corre contra la BD real: la tx serializable y las columnas del rastro son
//  parte del contrato.
// ─────────────────────────────────────────────────────────────────────────

const motivoBloqueo = "Demo prestada, acceso revocado"

type entornoBloqueo struct {
	svc      *auth.Service
	authRepo *auth.Repository
	userRepo *user.Repository
	pool     *pgxpool.Pool
	redis    *goredis.Client
}

// armarEntornoBloqueo toma el pool ANTES de sembrar nada (TestDB trunca al
// crearse) y devuelve las piezas para inspeccionar BD y Redis directamente.
func armarEntornoBloqueo(t *testing.T) entornoBloqueo {
	t.Helper()
	pool := testutil.TestDB(t)
	rdb := testutil.TestRedis(t)
	authRepo := auth.NewRepository(pool, rdb)
	userRepo := user.NewRepository(pool)
	svc := auth.NewService(
		authRepo,
		userRepo,
		wallet.NewRepository(pool),
		jwtpkg.NewManager("test-secret-key", 15*time.Minute, 7*24*time.Hour),
		&auth.Options{LockoutStore: middleware.NewRedisLockoutStore(rdb, time.Minute)},
	)
	return entornoBloqueo{svc: svc, authRepo: authRepo, userRepo: userRepo, pool: pool, redis: rdb}
}

// bloquear ejecuta el orden del servicio admin: tx en BD y DESPUES la marca en
// Redis. Devuelve cuantas sesiones revoco la tx.
func bloquear(t *testing.T, env entornoBloqueo, userID, adminID string) int {
	t.Helper()
	ctx := context.Background()
	found, n, err := env.authRepo.BlockUserAndRevokeSessions(ctx, userID, motivoBloqueo, adminID)
	if err != nil {
		t.Fatalf("BlockUserAndRevokeSessions: %v", err)
	}
	if !found {
		t.Fatal("la cuenta existia y found=false")
	}
	if err := env.authRepo.MarkUserBlocked(ctx, userID); err != nil {
		t.Fatalf("MarkUserBlocked: %v", err)
	}
	return n
}

// desbloquear ejecuta el orden inverso: DEL de la marca PRIMERO, luego la tx.
func desbloquear(t *testing.T, env entornoBloqueo, userID string) {
	t.Helper()
	ctx := context.Background()
	if err := env.authRepo.ClearUserBlocked(ctx, userID); err != nil {
		t.Fatalf("ClearUserBlocked: %v", err)
	}
	found, err := env.authRepo.UnblockUser(ctx, userID)
	if err != nil {
		t.Fatalf("UnblockUser: %v", err)
	}
	if !found {
		t.Fatal("la cuenta existia y found=false al desbloquear")
	}
}

func loginConCedula(svc *auth.Service, password string) (*auth.LoginResponse, error) {
	return svc.Login(context.Background(), &auth.LoginRequest{
		Identifier: "702650930", Password: password,
	}, emptyCtx)
}

func TestBlock_MataSesionYRefresh(t *testing.T) {
	env := armarEntornoBloqueo(t)
	ctx := context.Background()
	resp := registerTestUser(t, env.svc)

	// Precondicion: la sesion recien emitida esta viva.
	if revoked, err := env.authRepo.IsAccessJTIRevoked(ctx, resp.Tokens.AccessJTI); err != nil || revoked {
		t.Fatalf("precondicion: la sesion debia estar viva (revoked=%v, err=%v)", revoked, err)
	}

	if n := bloquear(t, env, resp.User.ID, ""); n < 1 {
		t.Fatalf("sessions_revoked = %d, esperaba al menos 1", n)
	}

	// SIN Redis: la BD sola ya mata el access token vigente (fila revocada en
	// user_sessions), que es lo que garantiza el efecto aunque Redis caiga.
	sinRedis := auth.NewRepository(env.pool, nil)
	revoked, err := sinRedis.IsAccessJTIRevoked(ctx, resp.Tokens.AccessJTI)
	if err != nil {
		t.Fatalf("IsAccessJTIRevoked sin Redis: %v", err)
	}
	if !revoked {
		t.Fatal("el access token debia quedar revocado en BD tras el bloqueo")
	}
	// Y sin Redis IsUserBlocked lee el status de la BD.
	if blocked, err := sinRedis.IsUserBlocked(ctx, resp.User.ID); err != nil || !blocked {
		t.Fatalf("IsUserBlocked sin Redis = (%v, %v), esperaba true", blocked, err)
	}

	// El refresh muere (familia revocada + status bloqueado).
	if _, err := env.svc.Refresh(ctx, resp.Tokens.RefreshToken, emptyCtx); err == nil {
		t.Fatal("el refresh de una cuenta bloqueada debia fallar")
	}

	// Con Redis, la marca responde el codigo distinguible.
	if blocked, err := env.authRepo.IsUserBlocked(ctx, resp.User.ID); err != nil || !blocked {
		t.Fatalf("IsUserBlocked con Redis = (%v, %v), esperaba true", blocked, err)
	}
}

func TestBlock_LoginDevuelveAccountBlocked(t *testing.T) {
	env := armarEntornoBloqueo(t)
	resp := registerTestUser(t, env.svc)
	bloquear(t, env, resp.User.ID, "")

	_, err := loginConCedula(env.svc, "Kiramopay2024!")
	if !errors.Is(err, auth.ErrAccountBlocked) {
		t.Fatalf("con la contrasena correcta esperaba ErrAccountBlocked, obtuve %v", err)
	}
}

// Con la contrasena mala la respuesta sigue siendo la constante de siempre:
// el codigo de bloqueo solo se revela a quien ya conoce la clave.
func TestBlock_LoginConPasswordMalaSigueSiendoCredencialesInvalidas(t *testing.T) {
	env := armarEntornoBloqueo(t)
	resp := registerTestUser(t, env.svc)
	bloquear(t, env, resp.User.ID, "")

	_, err := loginConCedula(env.svc, "ClaveIncorrecta2024!")
	if !errors.Is(err, auth.ErrInvalidCredentials) {
		t.Fatalf("con la contrasena mala esperaba ErrInvalidCredentials, obtuve %v", err)
	}
}

func TestUnblock_RestauraLogin(t *testing.T) {
	env := armarEntornoBloqueo(t)
	ctx := context.Background()
	resp := registerTestUser(t, env.svc)
	bloquear(t, env, resp.User.ID, "")
	desbloquear(t, env, resp.User.ID)

	if blocked, err := env.authRepo.IsUserBlocked(ctx, resp.User.ID); err != nil || blocked {
		t.Fatalf("tras desbloquear IsUserBlocked = (%v, %v), esperaba false", blocked, err)
	}
	if st, err := env.userRepo.GetStatus(ctx, resp.User.ID); err != nil || st != "active" {
		t.Fatalf("status tras desbloquear = (%q, %v), esperaba active", st, err)
	}
	if _, err := loginConCedula(env.svc, "Kiramopay2024!"); err != nil {
		t.Fatalf("la persona debia poder volver a entrar: %v", err)
	}
	// Las sesiones revocadas por el bloqueo NO resucitan.
	if _, err := env.svc.Refresh(ctx, resp.Tokens.RefreshToken, emptyCtx); err == nil {
		t.Fatal("el refresh token previo al bloqueo debia seguir muerto")
	}
	if revoked, _ := env.authRepo.IsAccessJTIRevoked(ctx, resp.Tokens.AccessJTI); !revoked {
		t.Fatal("el access token previo al bloqueo debia seguir revocado")
	}
}

func TestBlock_EsIdempotente(t *testing.T) {
	env := armarEntornoBloqueo(t)
	ctx := context.Background()
	resp := registerTestUser(t, env.svc)

	if n := bloquear(t, env, resp.User.ID, ""); n < 1 {
		t.Fatalf("primer bloqueo: sessions_revoked = %d", n)
	}
	// Segunda vez: no falla, no hay nada nuevo que revocar.
	if n := bloquear(t, env, resp.User.ID, ""); n != 0 {
		t.Fatalf("segundo bloqueo: sessions_revoked = %d, esperaba 0", n)
	}
	if st, _ := env.userRepo.GetStatus(ctx, resp.User.ID); st != "blocked" {
		t.Fatalf("status = %q, esperaba blocked", st)
	}
	if _, err := loginConCedula(env.svc, "Kiramopay2024!"); !errors.Is(err, auth.ErrAccountBlocked) {
		t.Fatalf("esperaba ErrAccountBlocked, obtuve %v", err)
	}
	// Desbloquear dos veces tampoco falla.
	desbloquear(t, env, resp.User.ID)
	desbloquear(t, env, resp.User.ID)
}

func TestBlock_UsuarioInexistente(t *testing.T) {
	env := armarEntornoBloqueo(t)
	ctx := context.Background()
	fantasma := uuid.New().String()

	found, n, err := env.authRepo.BlockUserAndRevokeSessions(ctx, fantasma, motivoBloqueo, "")
	if err != nil {
		t.Fatalf("BlockUserAndRevokeSessions: %v", err)
	}
	if found || n != 0 {
		t.Fatalf("found=%v n=%d, esperaba false/0", found, n)
	}
	if found, err := env.authRepo.UnblockUser(ctx, fantasma); err != nil || found {
		t.Fatalf("UnblockUser = (%v, %v), esperaba (false, nil)", found, err)
	}
	// Sin motivo no se bloquea a nadie (el CHECK de coherencia lo exige).
	if _, _, err := env.authRepo.BlockUserAndRevokeSessions(ctx, fantasma, "   ", ""); err == nil {
		t.Fatal("un motivo en blanco debia rechazarse")
	}
}

func TestReconcileBlockedMarks_ReponeLaMarca(t *testing.T) {
	env := armarEntornoBloqueo(t)
	ctx := context.Background()
	resp := registerTestUser(t, env.svc)
	bloquear(t, env, resp.User.ID, "")

	// Simula la perdida de Redis (FLUSHDB, reinicio, eviccion).
	if err := env.redis.FlushDB(ctx).Err(); err != nil {
		t.Fatalf("FlushDB: %v", err)
	}
	if blocked, _ := env.authRepo.IsUserBlocked(ctx, resp.User.ID); blocked {
		t.Fatal("precondicion: sin marca en Redis IsUserBlocked debia ser false")
	}

	puestas, quitadas, err := env.authRepo.ReconcileBlockedMarks(ctx)
	if err != nil {
		t.Fatalf("ReconcileBlockedMarks: %v", err)
	}
	if puestas != 1 || quitadas != 0 {
		t.Fatalf("marcas puestas/quitadas = %d/%d, esperaba 1/0", puestas, quitadas)
	}
	if blocked, err := env.authRepo.IsUserBlocked(ctx, resp.User.ID); err != nil || !blocked {
		t.Fatalf("tras el repaso IsUserBlocked = (%v, %v), esperaba true", blocked, err)
	}
	// Sin marca no queda ninguna clave suelta.
	if keys, _ := env.redis.Keys(ctx, "auth:blocked:*").Result(); len(keys) != 1 {
		t.Fatalf("claves auth:blocked:* = %d, esperaba 1", len(keys))
	}

	// La llave del turno vive fuera de ese prefijo: si compartiera prefijo, el
	// propio repaso la leeria como la marca de un usuario y la borraria.
	if _, err := env.authRepo.TryClaimBlockedReconcile(ctx, time.Minute); err != nil {
		t.Fatalf("TryClaimBlockedReconcile: %v", err)
	}
	if keys, _ := env.redis.Keys(ctx, "auth:blocked:*").Result(); len(keys) != 1 {
		t.Fatalf("la llave del turno cayo dentro del prefijo de las marcas: %v", keys)
	}
}

// El status bloqueado corta el refresh ANTES de consumir el token, aunque la
// familia siguiera viva (aqui se bloquea solo el status, sin revocar nada).
func TestRefresh_CuentaBloqueadaDevuelveAccountBlocked(t *testing.T) {
	env := armarEntornoBloqueo(t)
	ctx := context.Background()
	resp := registerTestUser(t, env.svc)

	if _, err := env.pool.Exec(ctx,
		`UPDATE users SET status = 'blocked', blocked_at = NOW(), blocked_reason = $2 WHERE id = $1`,
		resp.User.ID, motivoBloqueo,
	); err != nil {
		t.Fatalf("marcar status: %v", err)
	}

	_, err := env.svc.Refresh(ctx, resp.Tokens.RefreshToken, emptyCtx)
	if !errors.Is(err, auth.ErrAccountBlocked) {
		t.Fatalf("esperaba ErrAccountBlocked, obtuve %v", err)
	}
}

// ── Handlers: el 403 con codigo ACCOUNT_BLOCKED llega tal cual al cliente ──

type sobreError struct {
	Success bool `json:"success"`
	Error   *struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

func leerSobreError(t *testing.T, rec *httptest.ResponseRecorder) sobreError {
	t.Helper()
	var s sobreError
	if err := json.Unmarshal(rec.Body.Bytes(), &s); err != nil {
		t.Fatalf("cuerpo no es JSON: %v: %s", err, rec.Body.String())
	}
	return s
}

func TestLoginHandler_CuentaBloqueadaResponde403(t *testing.T) {
	env := armarEntornoBloqueo(t)
	resp := registerTestUser(t, env.svc)
	bloquear(t, env, resp.User.ID, "")
	h := auth.NewHandler(env.svc, auth.CookieConfig{Secure: true}, false)

	body := `{"identifier":"702650930","password":"Kiramopay2024!"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", strings.NewReader(body))
	rec := httptest.NewRecorder()
	h.Login(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, esperaba 403: %s", rec.Code, rec.Body.String())
	}
	s := leerSobreError(t, rec)
	if s.Success || s.Error == nil || s.Error.Code != "ACCOUNT_BLOCKED" {
		t.Fatalf("sobre inesperado: %s", rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), motivoBloqueo) {
		t.Fatal("el motivo del bloqueo no debe salir al cliente")
	}
	if rec.Header().Get("Cache-Control") != "no-store" {
		t.Errorf("Cache-Control = %q, esperaba no-store", rec.Header().Get("Cache-Control"))
	}
	if findCookie(rec, "__Host-kp_refresh") != nil {
		t.Fatal("una cuenta bloqueada no debe recibir cookie de refresh")
	}
}

func TestRefreshHandler_CuentaBloqueadaResponde403(t *testing.T) {
	env := armarEntornoBloqueo(t)
	resp := registerTestUser(t, env.svc)
	bloquear(t, env, resp.User.ID, "")
	h := auth.NewHandler(env.svc, auth.CookieConfig{Secure: true}, false)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/refresh", nil)
	req.AddCookie(&http.Cookie{Name: "__Host-kp_refresh", Value: resp.Tokens.RefreshToken})
	rec := httptest.NewRecorder()
	h.RefreshToken(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, esperaba 403: %s", rec.Code, rec.Body.String())
	}
	if s := leerSobreError(t, rec); s.Error == nil || s.Error.Code != "ACCOUNT_BLOCKED" {
		t.Fatalf("sobre inesperado: %s", rec.Body.String())
	}
}

// ── Ficha admin: enmascarado en SQL, rastro del bloqueo y busquedas ──

func TestGetAdminView_ReflejaElBloqueo(t *testing.T) {
	env := armarEntornoBloqueo(t)
	ctx := context.Background()
	resp := registerTestUser(t, env.svc)
	adminID := testutil.SeedTestUser2(t, env.pool) // role='admin', 'Admin User'

	antes, err := env.userRepo.GetAdminView(ctx, resp.User.ID)
	if err != nil {
		t.Fatalf("GetAdminView antes: %v", err)
	}
	if antes.Status != "active" || antes.BlockedAt != nil || antes.BlockedReason != "" || antes.BlockedByName != "" {
		t.Fatalf("ficha activa con rastro de bloqueo: %+v", antes)
	}
	if antes.FirstName != "Keilor" || antes.LastName != "Martinez" || antes.Role != "user" {
		t.Fatalf("identidad inesperada: %+v", antes)
	}
	// Enmascarado: nunca el dato completo, solo la cola.
	if strings.Contains(antes.CedulaMasked, "702650930") || !strings.HasSuffix(antes.CedulaMasked, "930") {
		t.Fatalf("cedula_masked = %q", antes.CedulaMasked)
	}
	if strings.Contains(antes.PhoneMasked, "50688881234") || !strings.HasSuffix(antes.PhoneMasked, "1234") {
		t.Fatalf("phone_masked = %q", antes.PhoneMasked)
	}
	if antes.EmailMasked != "" {
		t.Fatalf("sin correo registrado email_masked debia ser vacio, es %q", antes.EmailMasked)
	}

	bloquear(t, env, resp.User.ID, adminID)

	despues, err := env.userRepo.GetAdminView(ctx, resp.User.ID)
	if err != nil {
		t.Fatalf("GetAdminView despues: %v", err)
	}
	if despues.Status != "blocked" || despues.BlockedAt == nil {
		t.Fatalf("ficha bloqueada sin estado/fecha: %+v", despues)
	}
	if despues.BlockedReason != motivoBloqueo {
		t.Fatalf("blocked_reason = %q", despues.BlockedReason)
	}
	if despues.BlockedByName != "Admin User" {
		t.Fatalf("blocked_by_name = %q, esperaba Admin User", despues.BlockedByName)
	}

	lista, err := env.userRepo.ListBlockedAdminViews(ctx, 0)
	if err != nil {
		t.Fatalf("ListBlockedAdminViews: %v", err)
	}
	if len(lista) != 1 || lista[0].ID != resp.User.ID {
		t.Fatalf("bloqueadas = %+v, esperaba solo la cuenta bloqueada", lista)
	}

	desbloquear(t, env, resp.User.ID)
	limpia, err := env.userRepo.GetAdminView(ctx, resp.User.ID)
	if err != nil {
		t.Fatalf("GetAdminView tras desbloquear: %v", err)
	}
	if limpia.Status != "active" || limpia.BlockedAt != nil || limpia.BlockedReason != "" || limpia.BlockedByName != "" {
		t.Fatalf("el rastro debia limpiarse al desbloquear: %+v", limpia)
	}
	if lista, _ := env.userRepo.ListBlockedAdminViews(ctx, 0); len(lista) != 0 {
		t.Fatalf("tras desbloquear no debia quedar ninguna bloqueada; hay %d", len(lista))
	}

	// Inexistente: pgx.ErrNoRows envuelto.
	if _, err := env.userRepo.GetAdminView(ctx, uuid.New().String()); err == nil {
		t.Fatal("una cuenta inexistente debia dar error")
	}
}

func TestAdminView_BusquedaPorNombreYHash(t *testing.T) {
	env := armarEntornoBloqueo(t)
	ctx := context.Background()
	resp := registerTestUser(t, env.svc)

	porNombre, err := env.userRepo.SearchAdminViewByName(ctx, "keil", 20)
	if err != nil {
		t.Fatalf("SearchAdminViewByName: %v", err)
	}
	if len(porNombre) != 1 || porNombre[0].ID != resp.User.ID {
		t.Fatalf("busqueda por nombre parcial = %+v", porNombre)
	}
	// El comodin se escapa: "%" no lista la tabla entera.
	if todos, err := env.userRepo.SearchAdminViewByName(ctx, "%", 20); err != nil || len(todos) != 0 {
		t.Fatalf("el comodin debia neutralizarse: (%d, %v)", len(todos), err)
	}
	if guion, err := env.userRepo.SearchAdminViewByName(ctx, "_eilor", 20); err != nil || len(guion) != 0 {
		t.Fatalf("el guion bajo debia neutralizarse: (%d, %v)", len(guion), err)
	}

	porCedula, err := env.userRepo.FindAdminViewByHash(ctx, "cedula_hash", "702650930")
	if err != nil {
		t.Fatalf("FindAdminViewByHash cedula: %v", err)
	}
	if len(porCedula) != 1 || strings.Contains(porCedula[0].CedulaMasked, "702650930") {
		t.Fatalf("busqueda por cedula = %+v", porCedula)
	}
	porTelefono, err := env.userRepo.FindAdminViewByHash(ctx, "phone_hash", "+50688881234")
	if err != nil {
		t.Fatalf("FindAdminViewByHash telefono: %v", err)
	}
	if len(porTelefono) != 1 || porTelefono[0].ID != resp.User.ID {
		t.Fatalf("busqueda por telefono = %+v", porTelefono)
	}
	if nadie, err := env.userRepo.FindAdminViewByHash(ctx, "email_hash", "nadie@example.com"); err != nil || len(nadie) != 0 {
		t.Fatalf("correo inexistente = (%d, %v)", len(nadie), err)
	}
	// Columna fuera de la lista blanca: error, nunca SQL.
	if _, err := env.userRepo.FindAdminViewByHash(ctx, "password_hash", "x"); err == nil {
		t.Fatal("una columna fuera de la lista blanca debia rechazarse")
	}
}

// El canal B2B autentica por API key, no por JWT: el bloqueo tiene que revocar
// las keys en la misma tx o el bloqueado seguiria operando escrow y payouts.
func TestBlock_RevocaAPIKeysDeComercio(t *testing.T) {
	env := armarEntornoBloqueo(t)
	ctx := context.Background()
	resp := registerTestUser(t, env.svc)

	if _, err := env.pool.Exec(ctx,
		`INSERT INTO api_keys (user_id, name, prefix, key_hash, scopes)
		 VALUES ($1::uuid, 'tienda', 'kp_test', 'hash-bloqueo-0001', 'escrow:read,escrow:write')`,
		resp.User.ID); err != nil {
		t.Fatalf("sembrar api key: %v", err)
	}
	bloquear(t, env, resp.User.ID, "")

	var status string
	var revokedAt *time.Time
	if err := env.pool.QueryRow(ctx,
		`SELECT status, revoked_at FROM api_keys WHERE key_hash = 'hash-bloqueo-0001'`).Scan(&status, &revokedAt); err != nil {
		t.Fatalf("leer api key: %v", err)
	}
	if status != "revoked" || revokedAt == nil {
		t.Fatalf("api key tras el bloqueo: status=%q revoked_at=%v, esperaba revoked con fecha", status, revokedAt)
	}
	// Desbloquear no la resucita: el comercio genera keys nuevas.
	desbloquear(t, env, resp.User.ID)
	if err := env.pool.QueryRow(ctx,
		`SELECT status FROM api_keys WHERE key_hash = 'hash-bloqueo-0001'`).Scan(&status); err != nil {
		t.Fatalf("releer api key: %v", err)
	}
	if status != "revoked" {
		t.Fatalf("api key tras desbloquear: status=%q, debia seguir revoked", status)
	}
}
