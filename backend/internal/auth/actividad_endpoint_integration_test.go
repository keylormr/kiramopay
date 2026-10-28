package auth_test

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/kiramopay/backend/internal/auth"
	"github.com/kiramopay/backend/internal/middleware"
)

// RegistrarAccion es lo que hace POST /auth/activity: guarda la hora de la
// accion, siempre que la sesion siga viva.
func TestRegistrarAccion(t *testing.T) {
	t.Run("una sesion viva guarda la hora de la accion", func(t *testing.T) {
		env := armarEntornoBloqueo(t)
		resp := registerTestUser(t, env.svc)
		fijarAccion(t, env, resp.Tokens.RefreshJTI, 20*time.Minute)

		if err := env.svc.RegistrarAccion(context.Background(), resp.Tokens.AccessJTI); err != nil {
			t.Fatalf("RegistrarAccion: %v", err)
		}
		if hace := haceDeLaAccion(t, env, resp.Tokens.AccessJTI, "access_jti"); hace < 0 || hace > 30*time.Second {
			t.Fatalf("ultima accion hace %s, tenia que ser ahora", hace)
		}
	})

	t.Run("la primera vez empieza a contar la sesion", func(t *testing.T) {
		env := armarEntornoBloqueo(t)
		resp := registerTestUser(t, env.svc)
		fijarAccion(t, env, resp.Tokens.RefreshJTI, 0)

		if err := env.svc.RegistrarAccion(context.Background(), resp.Tokens.AccessJTI); err != nil {
			t.Fatalf("RegistrarAccion: %v", err)
		}
		if hace := haceDeLaAccion(t, env, resp.Tokens.AccessJTI, "access_jti"); hace < 0 || hace > 30*time.Second {
			t.Fatalf("ultima accion hace %s, tenia que ser ahora", hace)
		}
	})

	t.Run("un login nuevo no trae actividad: la llena el primer aviso", func(t *testing.T) {
		env := armarEntornoBloqueo(t)
		resp := registerTestUser(t, env.svc)

		// Un cliente que no sabe avisar no puede quedar con una hora puesta por
		// el servidor: lo cerraria a los 30 minutos con la persona usandolo.
		if hace := haceDeLaAccion(t, env, resp.Tokens.AccessJTI, "access_jti"); hace != -1 {
			t.Fatalf("la sesion recien abierta trae actividad (hace %s); tenia que venir vacia", hace)
		}
	})

	t.Run("pasada la ventana no resucita la sesion", func(t *testing.T) {
		env := armarEntornoBloqueo(t)
		resp := registerTestUser(t, env.svc)
		fijarAccion(t, env, resp.Tokens.RefreshJTI, 40*time.Minute)

		err := env.svc.RegistrarAccion(context.Background(), resp.Tokens.AccessJTI)
		if !errors.Is(err, auth.ErrSesionInactiva) {
			t.Fatalf("err = %v, se esperaba ErrSesionInactiva", err)
		}
		if hace := haceDeLaAccion(t, env, resp.Tokens.AccessJTI, "access_jti"); hace < 39*time.Minute {
			t.Fatalf("la ultima accion se movio a hace %s: una sesion vencida no se revive avisando", hace)
		}
	})

	t.Run("una sesion cerrada tampoco", func(t *testing.T) {
		env := armarEntornoBloqueo(t)
		resp := registerTestUser(t, env.svc)
		if err := env.authRepo.RevokeSessionByAccessJTI(context.Background(), resp.Tokens.AccessJTI); err != nil {
			t.Fatalf("revocar: %v", err)
		}

		err := env.svc.RegistrarAccion(context.Background(), resp.Tokens.AccessJTI)
		if !errors.Is(err, auth.ErrSesionInactiva) {
			t.Fatalf("err = %v, se esperaba ErrSesionInactiva", err)
		}
	})
}

func TestRegistrarActividadHandler(t *testing.T) {
	llamar := func(env entornoBloqueo, jti string) *httptest.ResponseRecorder {
		h := auth.NewHandler(env.svc, auth.CookieConfig{Secure: true}, false)
		req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/activity", nil)
		req = req.WithContext(context.WithValue(req.Context(), middleware.AccessJTIKey, jti))
		rec := httptest.NewRecorder()
		h.RegistrarActividad(rec, req)
		return rec
	}

	t.Run("sesion viva: 204", func(t *testing.T) {
		env := armarEntornoBloqueo(t)
		resp := registerTestUser(t, env.svc)
		if rec := llamar(env, resp.Tokens.AccessJTI); rec.Code != http.StatusNoContent {
			t.Fatalf("status = %d, esperaba 204: %s", rec.Code, rec.Body.String())
		}
	})

	t.Run("sesion vencida por inactividad: 401 SESSION_IDLE", func(t *testing.T) {
		env := armarEntornoBloqueo(t)
		resp := registerTestUser(t, env.svc)
		fijarAccion(t, env, resp.Tokens.RefreshJTI, 40*time.Minute)

		rec := llamar(env, resp.Tokens.AccessJTI)
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("status = %d, esperaba 401: %s", rec.Code, rec.Body.String())
		}
		if s := leerSobreError(t, rec); s.Error == nil || s.Error.Code != "SESSION_IDLE" {
			t.Fatalf("error = %+v, se esperaba SESSION_IDLE", s.Error)
		}
	})

	t.Run("sin token de acceso en el contexto: 401", func(t *testing.T) {
		env := armarEntornoBloqueo(t)
		registerTestUser(t, env.svc)
		if rec := llamar(env, ""); rec.Code != http.StatusUnauthorized {
			t.Fatalf("status = %d, esperaba 401", rec.Code)
		}
	})
}
