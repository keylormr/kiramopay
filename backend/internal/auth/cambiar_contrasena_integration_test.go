package auth_test

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/kiramopay/backend/internal/auth"
	"github.com/kiramopay/backend/internal/middleware"
)

// Cambiar la contrasena respondia el mismo CHANGE_PASSWORD_FAILED para "la
// actual no es esa" y para "la nueva es igual a la actual" (y un 400 con ese
// codigo tambien ante un error interno). La pantalla no podia distinguirlos y
// decia siempre "contrasena incorrecta": quien ponia como nueva la misma de
// siempre reintentaba una contrasena actual que si sabia.
func TestCambiarContrasenaHandler_CadaRechazoTraeSuCodigo(t *testing.T) {
	casos := []struct {
		nombre        string
		demo          bool
		actual, nueva string
		estado        int
		codigo        string
	}{
		{"la actual no es esa", false, "NoEsEsta2026!", "NuevaClave2026!", http.StatusBadRequest, "CURRENT_PASSWORD_INVALID"},
		{"la nueva es la misma que la actual", false, "Kiramopay2024!", "Kiramopay2024!", http.StatusBadRequest, "PASSWORD_UNCHANGED"},
		{"una cuenta que entra sin contrasena", true, "Kiramopay2024!", "NuevaClave2026!", http.StatusForbidden, "DEMO_ACCOUNT"},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			svc, pool, _ := servicioConDemo(t, true)
			id := sembrarConUsuario(t, pool, "702650930", "keilor", c.demo)
			h := auth.NewHandler(svc, auth.CookieConfig{Secure: true}, false)

			cuerpo := fmt.Sprintf(`{"old_password":%q,"new_password":%q}`, c.actual, c.nueva)
			req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/change-password", strings.NewReader(cuerpo))
			req = req.WithContext(context.WithValue(req.Context(), middleware.UserIDKey, id))
			rec := httptest.NewRecorder()

			h.ChangePassword(rec, req)

			if rec.Code != c.estado {
				t.Fatalf("status = %d, esperaba %d: %s", rec.Code, c.estado, rec.Body.String())
			}
			s := leerSobreError(t, rec)
			if s.Success || s.Error == nil || s.Error.Code != c.codigo {
				t.Fatalf("esperaba el codigo %s: %s", c.codigo, rec.Body.String())
			}
		})
	}
}

// cambiarContrasenaComo manda el cambio de contrasena con la sesion de userID.
func cambiarContrasenaComo(t *testing.T, h *auth.Handler, userID, actual, nueva string) *httptest.ResponseRecorder {
	t.Helper()
	cuerpo := fmt.Sprintf(`{"old_password":%q,"new_password":%q}`, actual, nueva)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/change-password", strings.NewReader(cuerpo))
	req = req.WithContext(context.WithValue(req.Context(), middleware.UserIDKey, userID))
	rec := httptest.NewRecorder()
	h.ChangePassword(rec, req)
	return rec
}

func codigoDeError(t *testing.T, rec *httptest.ResponseRecorder) string {
	t.Helper()
	s := leerSobreError(t, rec)
	if s.Error == nil {
		return ""
	}
	return s.Error.Code
}

// Cambiar la contrasena no tenia tope de intentos: con una sesion robada se
// podia probar la contrasena actual sin limite (solo el general de las rutas
// protegidas, 200 por minuto) y, al acertar, cambiarla y quedarse con la
// cuenta. Ahora tiene el mismo tope que el login, con su propio contador.
func TestCambiarContrasena_TopeDeIntentosConLaActualEquivocada(t *testing.T) {
	svc, pool, _ := servicioConDemo(t, true)
	id := sembrarConUsuario(t, pool, "702650930", "keilor", false)
	h := auth.NewHandler(svc, auth.CookieConfig{Secure: true}, false)

	for i := 1; i <= 5; i++ {
		rec := cambiarContrasenaComo(t, h, id, "NoEsEsta2026!", "NuevaClave2026!")
		if got := codigoDeError(t, rec); got != "CURRENT_PASSWORD_INVALID" {
			t.Fatalf("intento %d: codigo %q, esperaba CURRENT_PASSWORD_INVALID: %s", i, got, rec.Body.String())
		}
	}

	// Con el tope alcanzado tampoco pasa la contrasena correcta: si pasara, el
	// tope no protegeria nada, porque seguiria diciendo cual es la buena.
	rec := cambiarContrasenaComo(t, h, id, "Kiramopay2024!", "NuevaClave2026!")
	if rec.Code != http.StatusLocked {
		t.Fatalf("status = %d, esperaba 423: %s", rec.Code, rec.Body.String())
	}
	if got := codigoDeError(t, rec); got != "PASSWORD_CHANGE_LOCKED" {
		t.Fatalf("codigo %q, esperaba PASSWORD_CHANGE_LOCKED: %s", got, rec.Body.String())
	}

	// El contador es propio: si fuera el del login, quien robo la sesion
	// dejaria a la duena de la cuenta sin poder entrar a cerrar las demas
	// sesiones. Entrar con la contrasena de siempre prueba ademas que no
	// cambio.
	if _, err := svc.Login(context.Background(),
		&auth.LoginRequest{Identifier: "702650930", Password: "Kiramopay2024!"}, emptyCtx); err != nil {
		t.Fatalf("el login con la contrasena de siempre fallo: %v", err)
	}
}

// Acertar la contrasena actual reinicia el contador: equivocarse de vez en
// cuando a lo largo del tiempo no puede terminar en el tope.
func TestCambiarContrasena_AcertarLaActualReiniciaElTope(t *testing.T) {
	svc, pool, _ := servicioConDemo(t, true)
	id := sembrarConUsuario(t, pool, "702650930", "keilor", false)
	h := auth.NewHandler(svc, auth.CookieConfig{Secure: true}, false)

	for i := 1; i <= 4; i++ {
		cambiarContrasenaComo(t, h, id, "NoEsEsta2026!", "NuevaClave2026!")
	}
	// La actual es la correcta; se rechaza solo porque la nueva es igual.
	if got := codigoDeError(t, cambiarContrasenaComo(t, h, id, "Kiramopay2024!", "Kiramopay2024!")); got != "PASSWORD_UNCHANGED" {
		t.Fatalf("codigo %q, esperaba PASSWORD_UNCHANGED", got)
	}
	for i := 1; i <= 4; i++ {
		rec := cambiarContrasenaComo(t, h, id, "NoEsEsta2026!", "NuevaClave2026!")
		if got := codigoDeError(t, rec); got != "CURRENT_PASSWORD_INVALID" {
			t.Fatalf("intento %d despues de acertar: codigo %q, esperaba CURRENT_PASSWORD_INVALID: %s", i, got, rec.Body.String())
		}
	}
}
