package middleware

import (
	"net/http"

	"github.com/kiramopay/backend/pkg/response"
)

// CSRFProtection verifies Origin/Referer headers on state-changing requests.
func CSRFProtection(allowedOrigins []string) func(http.Handler) http.Handler {
	originSet := make(map[string]bool, len(allowedOrigins))
	for _, o := range allowedOrigins {
		originSet[o] = true
	}

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Safe methods and preflight don't need origin check
			if r.Method == http.MethodGet || r.Method == http.MethodHead || r.Method == http.MethodOptions {
				next.ServeHTTP(w, r)
				return
			}

			origin := r.Header.Get("Origin")
			if origin == "" {
				origin = r.Header.Get("Referer")
			}

			if origin == "" {
				response.Error(w, http.StatusForbidden, "CSRF_REJECTED", "missing origin header")
				return
			}

			if !originSet[origin] {
				response.Error(w, http.StatusForbidden, "CSRF_REJECTED", "origin not allowed")
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}
