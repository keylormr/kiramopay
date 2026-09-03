package middleware

import (
	"context"
	"net/http"

	"github.com/kiramopay/backend/pkg/response"
)

// BlockChecker reports whether an account has been blocked by an admin.
// Implemented by the auth repository (Redis mark warmed from the DB); kept as
// an interface so this package stays decoupled.
type BlockChecker interface {
	IsUserBlocked(ctx context.Context, userID string) (bool, error)
}

// RejectBlocked refuses every request from a blocked account with 403
// ACCOUNT_BLOCKED. Must be mounted AFTER the auth middleware (it reads the
// authenticated user id from the context); a missing id is 401.
// FAIL-CLOSED: a checker error (Redis down) is 503 AUTH_UNAVAILABLE, the same
// failure mode as AuthWithSessionCheck, so no new degraded path is introduced.
func RejectBlocked(checker BlockChecker) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			userID := GetUserID(r.Context())
			if userID == "" {
				response.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "authentication required")
				return
			}
			blocked, err := checker.IsUserBlocked(r.Context(), userID)
			if err != nil {
				response.Error(w, http.StatusServiceUnavailable, "AUTH_UNAVAILABLE", "auth subsystem temporarily unavailable")
				return
			}
			if blocked {
				response.Error(w, http.StatusForbidden, "ACCOUNT_BLOCKED", "account blocked")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
