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
