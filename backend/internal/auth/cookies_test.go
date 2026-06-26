package auth

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestRefreshCookieName(t *testing.T) {
	if got := (CookieConfig{Secure: true}).refreshCookieName(); got != "__Host-kp_refresh" {
		t.Errorf("secure name = %q, want __Host-kp_refresh", got)
	}
	if got := (CookieConfig{Secure: false}).refreshCookieName(); got != "kp_refresh" {
		t.Errorf("dev name = %q, want kp_refresh", got)
	}
}

func TestSetRefreshCookie_SecureAttributes(t *testing.T) {
	rec := httptest.NewRecorder()
	exp := time.Now().Add(time.Hour)
	(CookieConfig{Secure: true}).setRefreshCookie(rec, "tok-123", exp)

	cookies := rec.Result().Cookies()
	if len(cookies) != 1 {
		t.Fatalf("want 1 cookie, got %d", len(cookies))
	}
	c := cookies[0]
	if c.Name != "__Host-kp_refresh" {
		t.Errorf("name = %q", c.Name)
	}
	if c.Value != "tok-123" {
		t.Errorf("value = %q", c.Value)
	}
	if !c.HttpOnly {
		t.Error("refresh cookie must be HttpOnly (not readable by JS)")
	}
	if !c.Secure {
		t.Error("refresh cookie must be Secure in secure mode")
	}
	if c.SameSite != http.SameSiteStrictMode {
		t.Errorf("SameSite = %v, want Strict (the CSRF control)", c.SameSite)
	}
	if c.Path != "/" {
		t.Errorf("path = %q, want /", c.Path)
	}
}

func TestSetRefreshCookie_DevIsNotSecure(t *testing.T) {
	rec := httptest.NewRecorder()
	(CookieConfig{Secure: false}).setRefreshCookie(rec, "t", time.Now().Add(time.Hour))
	c := rec.Result().Cookies()[0]
	if c.Name != "kp_refresh" {
		t.Errorf("dev name = %q", c.Name)
	}
	if c.Secure {
		t.Error("dev cookie must not be Secure (served over plain HTTP)")
	}
}

func TestClearRefreshCookie(t *testing.T) {
	rec := httptest.NewRecorder()
	(CookieConfig{Secure: true}).clearRefreshCookie(rec)
	c := rec.Result().Cookies()[0]
	if c.MaxAge >= 0 {
		t.Errorf("MaxAge = %d, want negative (delete now)", c.MaxAge)
	}
	if c.Value != "" {
		t.Errorf("value = %q, want empty", c.Value)
	}
}

func TestRefreshTokenFromCookie(t *testing.T) {
	cfg := CookieConfig{Secure: true}

	withCookie := httptest.NewRequest(http.MethodPost, "/api/v1/auth/refresh", nil)
	withCookie.AddCookie(&http.Cookie{Name: "__Host-kp_refresh", Value: "abc"})
	if got := cfg.refreshTokenFromCookie(withCookie); got != "abc" {
		t.Errorf("got %q, want abc", got)
	}

	none := httptest.NewRequest(http.MethodPost, "/api/v1/auth/refresh", nil)
	if got := cfg.refreshTokenFromCookie(none); got != "" {
		t.Errorf("got %q, want empty", got)
	}
}
