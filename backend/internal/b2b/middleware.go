package b2b

import (
	"context"
	"net/http"
	"strings"

	"github.com/kiramopay/backend/internal/middleware"
	"github.com/kiramopay/backend/pkg/response"
)

type scopeContextKey string

// scopesKey carries the authenticated key's scope list through the request.
const scopesKey scopeContextKey = "b2b_scopes"

// APIKeyAuth authenticates merchant requests with an API key, accepted as
// `Authorization: Bearer kp_live_…` or `X-API-Key: kp_live_…`. On success it
// injects the owning user into the request context under the same key the JWT
// middleware uses (so domain handlers work unchanged) plus the key's scopes
// for RequireScope.
func APIKeyAuth(svc *Service) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			presented := r.Header.Get("X-API-Key")
			if presented == "" {
				if h := r.Header.Get("Authorization"); strings.HasPrefix(h, "Bearer ") {
					presented = strings.TrimPrefix(h, "Bearer ")
				}
			}
			if presented == "" {
				response.Error(w, http.StatusUnauthorized, "API_KEY_REQUIRED", "missing API key")
				return
			}
			userID, scopes, err := svc.Authenticate(r.Context(), presented)
			if err != nil {
				response.Error(w, http.StatusUnauthorized, "API_KEY_INVALID", "invalid or revoked API key")
				return
			}
			ctx := context.WithValue(r.Context(), middleware.UserIDKey, userID)
			ctx = context.WithValue(ctx, scopesKey, scopes)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// RequireScope gates a route group on one scope of the authenticated key.
// Requests authenticated by JWT (no scope info in context) are not its
// concern — it must only be mounted under APIKeyAuth.
func RequireScope(scope string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			scopes, _ := r.Context().Value(scopesKey).(string)
			if !HasScope(scopes, scope) {
				response.Error(w, http.StatusForbidden, "INSUFFICIENT_SCOPE",
					"this API key lacks the required scope: "+scope)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
