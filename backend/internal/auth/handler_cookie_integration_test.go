package auth_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/kiramopay/backend/internal/auth"
)

// findCookie returns the named cookie from a response, or nil.
func findCookie(rec *httptest.ResponseRecorder, name string) *http.Cookie {
	for _, c := range rec.Result().Cookies() {
		if c.Name == name {
			return c
		}
	}
	return nil
}

func registerTestUser(t *testing.T, svc *auth.Service) *auth.LoginResponse {
	t.Helper()
	resp, err := svc.Register(context.Background(), &auth.RegisterRequest{
		Cedula: "702650930", Phone: "+50688881234",
		FirstName: "Keilor", LastName: "Martinez", Password: "Kiramopay2024!",
	}, auth.LoginContext{})
	if err != nil {
		t.Fatalf("register: %v", err)
	}
	return resp
}

// TestLoginSetsRefreshCookie verifies that a successful login issues the refresh
// token as an HttpOnly, Secure cookie (so JS cannot read it) and marks the
// response uncacheable — while still returning the tokens in the body for
// backward compatibility.
func TestLoginSetsRefreshCookie(t *testing.T) {
	svc, _ := setupAuthService(t)
	registerTestUser(t, svc)
	h := auth.NewHandler(svc, auth.CookieConfig{Secure: true}, false)

	body := `{"cedula":"702650930","password":"Kiramopay2024!"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", strings.NewReader(body))
	rec := httptest.NewRecorder()
	h.Login(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("login returned %d: %s", rec.Code, rec.Body.String())
	}
	c := findCookie(rec, "__Host-kp_refresh")
	if c == nil {
		t.Fatal("login did not set the refresh cookie")
	}
	if c.Value == "" {
		t.Error("refresh cookie is empty")
	}
	if !c.HttpOnly || !c.Secure {
		t.Errorf("refresh cookie must be HttpOnly+Secure, got HttpOnly=%v Secure=%v", c.HttpOnly, c.Secure)
	}
	if rec.Header().Get("Cache-Control") != "no-store" {
		t.Errorf("Cache-Control = %q, want no-store", rec.Header().Get("Cache-Control"))
	}
}

// TestRefreshReadsCookie verifies that /auth/refresh accepts the refresh token
// from the cookie (no JSON body) and rotates it into a fresh cookie.
func TestRefreshReadsCookie(t *testing.T) {
	svc, _ := setupAuthService(t)
	resp := registerTestUser(t, svc)
	h := auth.NewHandler(svc, auth.CookieConfig{Secure: true}, false)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/refresh", nil)
	req.AddCookie(&http.Cookie{Name: "__Host-kp_refresh", Value: resp.Tokens.RefreshToken})
	rec := httptest.NewRecorder()
	h.RefreshToken(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("refresh returned %d: %s", rec.Code, rec.Body.String())
	}
	rotated := findCookie(rec, "__Host-kp_refresh")
	if rotated == nil || rotated.Value == "" {
		t.Fatal("refresh did not set a rotated cookie")
	}
	if rotated.Value == resp.Tokens.RefreshToken {
		t.Error("refresh token should rotate, but the cookie carries the same value")
	}
}

// TestRefreshFallsBackToBody verifies backward compatibility: a client that
// still posts the refresh token in the JSON body (no cookie) keeps working.
func TestRefreshFallsBackToBody(t *testing.T) {
	svc, _ := setupAuthService(t)
	resp := registerTestUser(t, svc)
	h := auth.NewHandler(svc, auth.CookieConfig{Secure: true}, false)

	body := `{"refresh_token":"` + resp.Tokens.RefreshToken + `"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/refresh", strings.NewReader(body))
	rec := httptest.NewRecorder()
	h.RefreshToken(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("body-based refresh returned %d: %s", rec.Code, rec.Body.String())
	}
}
