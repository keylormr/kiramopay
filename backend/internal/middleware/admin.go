package middleware

import (
	"context"
	"net/http"

	"github.com/kiramopay/backend/pkg/response"
)

// AdminChecker reports whether a user has the admin role. Implemented by the
// user repository; kept as an interface so this package stays decoupled.
type AdminChecker interface {
	IsAdmin(ctx context.Context, userID string) (bool, error)
}

// RequireAdmin gates a route group to admin users. Must run AFTER the auth
// middleware (it reads the authenticated user id from the context).
// FAIL-CLOSED: a missing user id or a checker error returns 403.
func RequireAdmin(checker AdminChecker) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			userID := GetUserID(r.Context())
			if userID == "" {
				response.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "authentication required")
				return
			}
			ok, err := checker.IsAdmin(r.Context(), userID)
			if err != nil || !ok {
				response.Error(w, http.StatusForbidden, "FORBIDDEN", "admin privileges required")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// LiveSessionChecker dice si el token de acceso es el vigente de una sesion
// abierta de esa persona. Lo implementa el repositorio de auth.
type LiveSessionChecker interface {
	IsLiveSession(ctx context.Context, userID, accessJTI string) (bool, error)
}

// RequireLiveSession exige, en el panel de administracion, que el token de
// acceso sea el vigente de una sesion abierta. AuthWithSessionCheck deja pasar
// un token sin fila en user_sessions (uno que ya roto, hasta que vence), y como
// RequireAdmin lee el rol en cada peticion, ese token abria el panel aunque la
// sesion se hubiera revocado: un cambio de contrasena o la migracion 082 no lo
// alcanzaban. Va DESPUES de RequireAdmin, para que quien no administra no pague
// la consulta.
//
// Un token que no es el vigente responde 401 SESSION_REVOKED: el cliente
// renueva y reintenta. FAIL-CLOSED: si no se puede consultar, 503, como
// AuthWithSessionCheck.
func RequireLiveSession(checker LiveSessionChecker) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			userID := GetUserID(r.Context())
			jti := GetAccessJTI(r.Context())
			if userID == "" || jti == "" {
				response.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "authentication required")
				return
			}
			viva, err := checker.IsLiveSession(r.Context(), userID, jti)
			if err != nil {
				response.Error(w, http.StatusServiceUnavailable, "AUTH_UNAVAILABLE", "auth subsystem temporarily unavailable")
				return
			}
			if !viva {
				response.Error(w, http.StatusUnauthorized, "SESSION_REVOKED", "session has been revoked")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
