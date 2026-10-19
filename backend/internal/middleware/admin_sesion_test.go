package middleware

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

type fakeLiveSession struct {
	viva   bool
	err    error
	vistos *[][2]string
}

func (f fakeLiveSession) IsLiveSession(_ context.Context, userID, accessJTI string) (bool, error) {
	if f.vistos != nil {
		*f.vistos = append(*f.vistos, [2]string{userID, accessJTI})
	}
	return f.viva, f.err
}

func pedirConSesion(t *testing.T, userID, jti string, checker LiveSessionChecker) (int, string) {
	t.Helper()
	h := RequireLiveSession(checker)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	req := httptest.NewRequest(http.MethodGet, "/admin/x", nil)
	ctx := req.Context()
	if userID != "" {
		ctx = context.WithValue(ctx, UserIDKey, userID)
	}
	if jti != "" {
		ctx = context.WithValue(ctx, AccessJTIKey, jti)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req.WithContext(ctx))
	var cuerpo struct {
		Error *struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &cuerpo)
	if cuerpo.Error == nil {
		return rec.Code, ""
	}
	return rec.Code, cuerpo.Error.Code
}

// El panel de administracion solo acepta el token de acceso VIGENTE de una
// sesion abierta. IsAccessJTIRevoked deja pasar un token sin fila (uno que ya
// roto, hasta que vence), y con el rol leido en cada peticion ese token abria
// el panel aunque la sesion se hubiera revocado.
func TestRequireLiveSession_PasaConLaSesionVigente(t *testing.T) {
	var vistos [][2]string
	code, _ := pedirConSesion(t, "u1", "jti-1", fakeLiveSession{viva: true, vistos: &vistos})
	if code != http.StatusOK {
		t.Fatalf("una sesion vigente dio %d; se esperaba 200", code)
	}
	if len(vistos) != 1 || vistos[0] != [2]string{"u1", "jti-1"} {
		t.Fatalf("se consulto %v; se esperaba la sesion de u1 con jti-1", vistos)
	}
}

// Un token que ya no es el vigente responde 401 SESSION_REVOKED: el cliente
// renueva y reintenta con el nuevo, como ante cualquier sesion revocada.
func TestRequireLiveSession_RechazaUnTokenQueNoEsElVigente(t *testing.T) {
	code, codigo := pedirConSesion(t, "u1", "jti-viejo", fakeLiveSession{viva: false})
	if code != http.StatusUnauthorized || codigo != "SESSION_REVOKED" {
		t.Fatalf("un token sin sesion vigente dio %d %q; se esperaba 401 SESSION_REVOKED", code, codigo)
	}
}

// Fail-closed, como AuthWithSessionCheck: si no se puede consultar, no pasa.
func TestRequireLiveSession_FallaCerradoSiNoPuedeConsultar(t *testing.T) {
	code, codigo := pedirConSesion(t, "u1", "jti-1", fakeLiveSession{err: errors.New("db down")})
	if code != http.StatusServiceUnavailable || codigo != "AUTH_UNAVAILABLE" {
		t.Fatalf("con la base caida dio %d %q; se esperaba 503 AUTH_UNAVAILABLE", code, codigo)
	}
}

// Sin usuario o sin jti en el contexto no hay sesion que mirar: 401, sin
// consultar.
func TestRequireLiveSession_SinUsuarioOSinJTINoPasa(t *testing.T) {
	for _, c := range []struct{ que, usuario, jti string }{
		{"sin usuario", "", "jti-1"},
		{"sin jti", "u1", ""},
	} {
		var vistos [][2]string
		code, _ := pedirConSesion(t, c.usuario, c.jti, fakeLiveSession{viva: true, vistos: &vistos})
		if code != http.StatusUnauthorized {
			t.Errorf("%s dio %d; se esperaba 401", c.que, code)
		}
		if len(vistos) != 0 {
			t.Errorf("%s consulto la sesion %v; no debia", c.que, vistos)
		}
	}
}
