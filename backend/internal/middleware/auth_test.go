package middleware

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	jwtpkg "github.com/kiramopay/backend/pkg/jwt"
)

// mockJTIChecker implements JTIChecker for tests.
type mockJTIChecker struct {
	revoked map[string]bool
	err     error
	calls   int
}

func (m *mockJTIChecker) IsAccessJTIRevoked(_ context.Context, jti string) (bool, error) {
	m.calls++
	if m.err != nil {
		return false, m.err
	}
	return m.revoked[jti], nil
}

func newTestJWTManager() *jwtpkg.Manager {
	return jwtpkg.NewManager("test-secret-key-for-testing-only", 15*time.Minute, 7*24*time.Hour)
}

func TestAuth_ValidTokenActiveSession(t *testing.T) {
	jm := newTestJWTManager()
	tokens, _ := jm.GenerateTokenPair("user-123")

	checker := &mockJTIChecker{revoked: map[string]bool{}}
	handler := AuthWithSessionCheck(jm, checker)(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			userID := GetUserID(r.Context())
			if userID != "user-123" {
				t.Errorf("expected user-123, got %s", userID)
			}
			if GetAccessJTI(r.Context()) == "" {
				t.Error("expected access jti in context")
			}
			w.WriteHeader(http.StatusOK)
		}),
	)

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer "+tokens.AccessToken)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("valid token + active session: got %d, want %d", rec.Code, http.StatusOK)
	}
}

func TestAuth_ValidTokenRevokedJTI(t *testing.T) {
	jm := newTestJWTManager()
	tokens, _ := jm.GenerateTokenPair("user-123")

	checker := &mockJTIChecker{revoked: map[string]bool{tokens.AccessJTI: true}}
	handler := AuthWithSessionCheck(jm, checker)(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			t.Error("handler should not be called for revoked session")
		}),
	)
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer "+tokens.AccessToken)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("revoked: got %d, want %d", rec.Code, http.StatusUnauthorized)
	}
}

func TestAuth_FailClosedOnCheckerError(t *testing.T) {
	jm := newTestJWTManager()
	tokens, _ := jm.GenerateTokenPair("user-123")

	checker := &mockJTIChecker{err: context.DeadlineExceeded}
	handler := AuthWithSessionCheck(jm, checker)(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			t.Error("handler must NOT be called when checker errors (fail-closed)")
		}),
	)
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer "+tokens.AccessToken)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusServiceUnavailable {
		t.Errorf("expected 503 on checker error (fail-closed), got %d", rec.Code)
	}
}

func TestAuth_RefreshTokenRejectedAsAccess(t *testing.T) {
	jm := newTestJWTManager()
	tokens, _ := jm.GenerateTokenPair("user-123")

	checker := &mockJTIChecker{revoked: map[string]bool{}}
	handler := AuthWithSessionCheck(jm, checker)(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			t.Error("refresh token must NOT validate as access")
		}),
	)
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer "+tokens.RefreshToken)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", rec.Code)
	}
}

func TestAuth_MissingHeader(t *testing.T) {
	jm := newTestJWTManager()
	checker := &mockJTIChecker{revoked: map[string]bool{}}
	handler := AuthWithSessionCheck(jm, checker)(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			t.Error("handler should not be called")
		}),
	)
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("missing header: got %d, want %d", rec.Code, http.StatusUnauthorized)
	}
}

func TestAuth_InvalidFormat(t *testing.T) {
	jm := newTestJWTManager()
	checker := &mockJTIChecker{revoked: map[string]bool{}}
	handler := AuthWithSessionCheck(jm, checker)(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			t.Error("handler should not be called")
		}),
	)
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "InvalidFormat")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("invalid format: got %d, want %d", rec.Code, http.StatusUnauthorized)
	}
}
