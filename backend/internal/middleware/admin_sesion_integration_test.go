package middleware_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/kiramopay/backend/internal/auth"
	"github.com/kiramopay/backend/internal/middleware"
	"github.com/kiramopay/backend/internal/testutil"
	"github.com/kiramopay/backend/internal/user"
	"github.com/kiramopay/backend/internal/wallet"
	"github.com/kiramopay/backend/pkg/hash"
	jwtpkg "github.com/kiramopay/backend/pkg/jwt"
)

// El escenario de la revision del PR 295, con la cadena de main.go: un
// administrador renueva su sesion y guarda el token de acceso anterior. Ese
// token no tiene fila (la rotacion la movio al nuevo), IsAccessJTIRevoked lo
// deja pasar hasta que vence y RequireAdmin solo mira el rol. Con
// RequireLiveSession el panel solo acepta el token vigente, y uno revocado
// tampoco entra.
func TestPanelDeAdministracion_SoloAceptaElTokenVigente(t *testing.T) {
	ctx := context.Background()
	pool := testutil.TestDB(t)
	redis := testutil.TestRedis(t)
	jwtMgr := jwtpkg.NewManager("test-secret-key", 15*time.Minute, 7*24*time.Hour)
	authRepo := auth.NewRepository(pool, redis)
	userRepo := user.NewRepository(pool)
	svc := auth.NewService(authRepo, userRepo, wallet.NewRepository(pool), jwtMgr,
		&auth.Options{LockoutStore: middleware.NewRedisLockoutStore(redis, time.Minute)})

	pinHash, err := hash.HashPin("Kiramopay2024!")
	if err != nil {
		t.Fatalf("hash: %v", err)
	}
	admin := testutil.SeedTestUser(t, pool, "700000000", pinHash)
	if _, err := pool.Exec(ctx, `UPDATE users SET role = 'admin' WHERE id = $1::uuid`, admin); err != nil {
		t.Fatalf("dar el rol: %v", err)
	}

	sesion, err := svc.Login(ctx, &auth.LoginRequest{Identifier: "700000000", Password: "Kiramopay2024!"}, auth.LoginContext{})
	if err != nil {
		t.Fatalf("entrar: %v", err)
	}
	renovada, err := svc.Refresh(ctx, sesion.Tokens.RefreshToken, auth.LoginContext{})
	if err != nil {
		t.Fatalf("renovar: %v", err)
	}

	panel := middleware.AuthWithSessionCheck(jwtMgr, authRepo)(
		middleware.RequireAdmin(userRepo)(
			middleware.RequireLiveSession(authRepo)(
				http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) }))))
	pedir := func(token string) int {
		req := httptest.NewRequest(http.MethodGet, "/admin/merchants/pending", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		rec := httptest.NewRecorder()
		panel.ServeHTTP(rec, req)
		return rec.Code
	}

	if code := pedir(renovada.AccessToken); code != http.StatusOK {
		t.Fatalf("el token vigente dio %d en el panel; se esperaba 200", code)
	}
	if code := pedir(sesion.Tokens.AccessToken); code != http.StatusUnauthorized {
		t.Errorf("el token anterior a la renovacion dio %d en el panel; se esperaba 401", code)
	}

	if _, err := pool.Exec(ctx,
		`UPDATE user_sessions SET revoked_at = NOW() WHERE user_id = $1::uuid`, admin); err != nil {
		t.Fatalf("revocar: %v", err)
	}
	if code := pedir(renovada.AccessToken); code != http.StatusUnauthorized {
		t.Errorf("el token de una sesion revocada dio %d en el panel; se esperaba 401", code)
	}
}
