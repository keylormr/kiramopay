package b2b

import (
	"context"
	"net/http"
	"strings"

	"github.com/kiramopay/backend/internal/middleware"
	"github.com/kiramopay/backend/pkg/response"
)

// APIKeyAuth authenticates merchant requests with an API key, accepted as
// `Authorization: Bearer kp_live_…` or `X-API-Key: kp_live_…`. On success it
// injects the owning user into the request context under the same key the JWT
// middleware uses, so domain handlers (escrow, …) work unchanged.
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
			userID, err := svc.Authenticate(r.Context(), presented)
			if err != nil {
				response.Error(w, http.StatusUnauthorized, "API_KEY_INVALID", "invalid or revoked API key")
				return
			}
			ctx := context.WithValue(r.Context(), middleware.UserIDKey, userID)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}
