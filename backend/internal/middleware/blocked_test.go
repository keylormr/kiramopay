package middleware

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

type fakeBlockChecker struct {
	blocked bool
	err     error
}

func (f fakeBlockChecker) IsUserBlocked(_ context.Context, _ string) (bool, error) {
	return f.blocked, f.err
}

// runRejectBlocked serves one request through RejectBlocked and returns the
// status plus the error code from the JSON envelope ("" on success).
func runRejectBlocked(t *testing.T, userID string, checker BlockChecker) (int, string) {
	t.Helper()
	h := RejectBlocked(checker)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	req := httptest.NewRequest(http.MethodGet, "/wallet", nil)
	if userID != "" {
		req = req.WithContext(context.WithValue(req.Context(), UserIDKey, userID))
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	var body struct {
		Error *struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	code := ""
	if body.Error != nil {
		code = body.Error.Code
	}
	return rec.Code, code
}

func TestRejectBlocked_BlockedIs403AccountBlocked(t *testing.T) {
	status, code := runRejectBlocked(t, "u1", fakeBlockChecker{blocked: true})
	if status != http.StatusForbidden {
		t.Fatalf("blocked account should be 403, got %d", status)
	}
	if code != "ACCOUNT_BLOCKED" {
		t.Fatalf("error code = %q, want ACCOUNT_BLOCKED", code)
	}
}

func TestRejectBlocked_NotBlockedPasses(t *testing.T) {
	if status, _ := runRejectBlocked(t, "u1", fakeBlockChecker{blocked: false}); status != http.StatusOK {
		t.Fatalf("active account should pass, got %d", status)
	}
}

func TestRejectBlocked_FailsClosedOnError(t *testing.T) {
	status, code := runRejectBlocked(t, "u1", fakeBlockChecker{err: errors.New("redis down")})
	if status != http.StatusServiceUnavailable {
		t.Fatalf("checker error should be 503 (fail-closed), got %d", status)
	}
	if code != "AUTH_UNAVAILABLE" {
		t.Fatalf("error code = %q, want AUTH_UNAVAILABLE", code)
	}
}

func TestRejectBlocked_RejectsMissingUser(t *testing.T) {
	if status, _ := runRejectBlocked(t, "", fakeBlockChecker{blocked: false}); status != http.StatusUnauthorized {
		t.Fatalf("missing user should be 401, got %d", status)
	}
}
