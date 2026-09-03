package auth_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/kiramopay/backend/internal/auth"
	"github.com/kiramopay/backend/internal/middleware"
	"github.com/kiramopay/backend/internal/testutil"
	"github.com/kiramopay/backend/internal/user"
	"github.com/kiramopay/backend/internal/wallet"
	jwtpkg "github.com/kiramopay/backend/pkg/jwt"
)

// cuerpoRegistro arma un registro valido en forma con la cedula, el telefono y
// el codigo de invitacion dados (el codigo vacio se omite).
func cuerpoRegistro(cedula, phone, referralCode string) string {
	body := `{"cedula":"` + cedula + `","phone":"` + phone + `","first_name":"Prueba","last_name":"Registro","password":"Kiramopay2024!"`
	if referralCode != "" {
		body += `,"referral_code":"` + referralCode + `"`
	}
	return body + `}`
}

// postRegistro manda el cuerpo a POST /auth/register con el contexto dado.
func postRegistro(ctx context.Context, h *auth.Handler, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/register", strings.NewReader(body)).WithContext(ctx)
	rec := httptest.NewRecorder()
	h.Register(rec, req)
	return rec
}

func exigirSinUsuario(t *testing.T, repo *user.Repository, cedula string) {
	t.Helper()
	if u, _ := repo.FindByCedula(context.Background(), cedula); u != nil {
		t.Fatalf("no debia quedar una cuenta creada con la cedula %s", cedula)
	}
}

// La cedula ya tiene cuenta: 409 USER_EXISTS y un mensaje sin rastro de la
// base de datos (antes salia el texto crudo del error en un 409 generico).
func TestRegisterHandler_CedulaDuplicada(t *testing.T) {
	svc, _ := setupAuthService(t)
	registerTestUser(t, svc)
	h := auth.NewHandler(svc, auth.CookieConfig{Secure: true}, false)

	rec := postRegistro(context.Background(), h, cuerpoRegistro("702650930", "+50688885678", ""))
	if rec.Code != http.StatusConflict {
		t.Fatalf("register returned %d, want 409: %s", rec.Code, rec.Body.String())
	}
	if code, _ := leerError(t, rec); code != "USER_EXISTS" {
		t.Fatalf("error.code = %q, want USER_EXISTS", code)
	}
	exigirSinTextoInterno(t, rec.Body.String())
}

// El telefono ya tiene cuenta (choca en el indice unico al insertar, no en la
// busqueda previa por cedula): tambien 409 USER_EXISTS, sin texto de la BD, y
// no queda una cuenta a medias con la cedula nueva.
func TestRegisterHandler_TelefonoDuplicado(t *testing.T) {
	svc, _ := setupAuthService(t)
	pool := testutil.TestDB(t)
	registerTestUser(t, svc)
	h := auth.NewHandler(svc, auth.CookieConfig{Secure: true}, false)

	rec := postRegistro(context.Background(), h, cuerpoRegistro("304440999", "+50688881234", ""))
	if rec.Code != http.StatusConflict {
		t.Fatalf("register returned %d, want 409: %s", rec.Code, rec.Body.String())
	}
	if code, _ := leerError(t, rec); code != "USER_EXISTS" {
		t.Fatalf("error.code = %q, want USER_EXISTS", code)
	}
	exigirSinTextoInterno(t, rec.Body.String())
	exigirSinUsuario(t, user.NewRepository(pool), "304440999")
}

// Con la verificacion de telefono exigida y sin token: 403 PHONE_NOT_VERIFIED
// y nada creado.
func TestRegisterHandler_TelefonoSinVerificar(t *testing.T) {
	pool := testutil.TestDB(t)
	redis := testutil.TestRedis(t)
	svc := auth.NewService(
		auth.NewRepository(pool, redis),
		user.NewRepository(pool),
		wallet.NewRepository(pool),
		jwtpkg.NewManager("test-secret-key", 15*time.Minute, 7*24*time.Hour),
		&auth.Options{
			LockoutStore:             middleware.NewRedisLockoutStore(redis, time.Minute),
			RequirePhoneVerification: true,
		},
	)
	h := auth.NewHandler(svc, auth.CookieConfig{Secure: true}, false)

	rec := postRegistro(context.Background(), h, cuerpoRegistro("702650930", "+50688881234", ""))
	if rec.Code != http.StatusForbidden {
		t.Fatalf("register returned %d, want 403: %s", rec.Code, rec.Body.String())
	}
	if code, _ := leerError(t, rec); code != "PHONE_NOT_VERIFIED" {
		t.Fatalf("error.code = %q, want PHONE_NOT_VERIFIED", code)
	}
	exigirSinUsuario(t, user.NewRepository(pool), "702650930")
}

// Un fallo de infraestructura (aqui: la consulta del codigo de invitacion
// muere por contexto cancelado) es un 500 REGISTER_FAILED con el mensaje fijo
// del contrato. No puede disfrazarse de 400 REFERRAL_CODE_INVALID (mandaria
// al invitado a "corregir" un codigo que quiza es correcto) ni repetir el
// error interno en el cuerpo.
func TestRegisterHandler_ErrorInternoMensajeFijo(t *testing.T) {
	svc, _ := setupAuthService(t)
	h := auth.NewHandler(svc, auth.CookieConfig{Secure: true}, false)

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	rec := postRegistro(ctx, h, cuerpoRegistro("702650930", "+50688881234", "ZZZZZZ22"))
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("register returned %d, want 500: %s", rec.Code, rec.Body.String())
	}
	code, message := leerError(t, rec)
	if code != "REGISTER_FAILED" {
		t.Fatalf("error.code = %q, want REGISTER_FAILED", code)
	}
	// response.Error sustituye el texto de todo 5xx por su generico; lo que
	// importa es que el codigo llegue y que el detalle interno no.
	if message != "internal server error" {
		t.Fatalf("error.message = %q, debe ser el generico de response.Error", message)
	}
	exigirSinTextoInterno(t, rec.Body.String())
}
