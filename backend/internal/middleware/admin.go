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
