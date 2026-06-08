package middleware

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

type fakeAdminChecker struct {
	admin bool
	err   error
}

func (f fakeAdminChecker) IsAdmin(_ context.Context, _ string) (bool, error) {
	return f.admin, f.err
}

func runRequireAdmin(t *testing.T, userID string, checker AdminChecker) int {
	t.Helper()
	h := RequireAdmin(checker)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	req := httptest.NewRequest(http.MethodGet, "/admin/x", nil)
	if userID != "" {
		req = req.WithContext(context.WithValue(req.Context(), UserIDKey, userID))
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec.Code
}

func TestRequireAdmin_AllowsAdmin(t *testing.T) {
	if code := runRequireAdmin(t, "u1", fakeAdminChecker{admin: true}); code != http.StatusOK {
		t.Fatalf("admin should pass, got %d", code)
	}
}

func TestRequireAdmin_RejectsNonAdmin(t *testing.T) {
	if code := runRequireAdmin(t, "u1", fakeAdminChecker{admin: false}); code != http.StatusForbidden {
		t.Fatalf("non-admin should be 403, got %d", code)
	}
}

func TestRequireAdmin_RejectsMissingUser(t *testing.T) {
	if code := runRequireAdmin(t, "", fakeAdminChecker{admin: true}); code != http.StatusUnauthorized {
		t.Fatalf("missing user should be 401, got %d", code)
	}
}

func TestRequireAdmin_FailsClosedOnError(t *testing.T) {
	if code := runRequireAdmin(t, "u1", fakeAdminChecker{err: errors.New("db down")}); code != http.StatusForbidden {
		t.Fatalf("checker error should be 403 (fail-closed), got %d", code)
	}
}
