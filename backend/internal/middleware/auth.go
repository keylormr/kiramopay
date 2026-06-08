package middleware

import (
	"context"
	"net/http"
	"strings"

	jwtpkg "github.com/kiramopay/backend/pkg/jwt"
	"github.com/kiramopay/backend/pkg/response"
)

type contextKey string

const (
	UserIDKey    contextKey = "user_id"
	AccessJTIKey contextKey = "access_jti"
	AccessExpKey contextKey = "access_exp"
	AccessRawKey contextKey = "access_raw"
)

// JTIChecker validates whether an access-token jti has been revoked.
type JTIChecker interface {
	IsAccessJTIRevoked(ctx context.Context, jti string) (bool, error)
}

// Auth validates JWT tokens (backward-compatible, no jti revocation check).
func Auth(jwtManager *jwtpkg.Manager) func(http.Handler) http.Handler {
	return AuthWithSessionCheck(jwtManager, nil)
}

// AuthWithSessionCheck validates JWT tokens and optionally checks jti revocation.
// FAIL-CLOSED: when checker errors (Redis down, DB down), the request is rejected.
// This is the right behaviour for a money-moving API.
func AuthWithSessionCheck(jwtManager *jwtpkg.Manager, checker JTIChecker) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			authHeader := r.Header.Get("Authorization")
			if authHeader == "" {
				response.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "missing authorization header")
				return
			}

			parts := strings.SplitN(authHeader, " ", 2)
			if len(parts) != 2 || strings.ToLower(parts[0]) != "bearer" {
				response.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "invalid authorization format")
				return
			}

			token := parts[1]
			claims, err := jwtManager.ValidateAccess(token)
			if err != nil {
				response.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "invalid or expired token")
				return
			}

			if checker != nil {
				revoked, err := checker.IsAccessJTIRevoked(r.Context(), claims.ID)
				if err != nil {
					// Fail closed.
					response.Error(w, http.StatusServiceUnavailable, "AUTH_UNAVAILABLE", "auth subsystem temporarily unavailable")
					return
				}
				if revoked {
					response.Error(w, http.StatusUnauthorized, "SESSION_REVOKED", "session has been revoked")
					return
				}
			}

			ctx := context.WithValue(r.Context(), UserIDKey, claims.UserID)
			ctx = context.WithValue(ctx, AccessJTIKey, claims.ID)
			if claims.ExpiresAt != nil {
				ctx = context.WithValue(ctx, AccessExpKey, claims.ExpiresAt.Unix())
			}
			ctx = context.WithValue(ctx, AccessRawKey, token)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func GetUserID(ctx context.Context) string {
	if id, ok := ctx.Value(UserIDKey).(string); ok {
		return id
	}
	return ""
}

func GetAccessJTI(ctx context.Context) string {
	if v, ok := ctx.Value(AccessJTIKey).(string); ok {
		return v
	}
	return ""
}

func GetAccessExp(ctx context.Context) int64 {
	if v, ok := ctx.Value(AccessExpKey).(int64); ok {
		return v
	}
	return 0
}
