package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCSRF_GETPassesWithoutOrigin(t *testing.T) {
	handler := CSRFProtection([]string{"https://app.kiramopay.com"})(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
		}),
	)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/users/me", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("GET without Origin: got status %d, want %d", rec.Code, http.StatusOK)
	}
}

func TestCSRF_POSTWithoutOriginForbidden(t *testing.T) {
	handler := CSRFProtection([]string{"https://app.kiramopay.com"})(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
		}),
	)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/sinpe/send", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Errorf("POST without Origin: got status %d, want %d", rec.Code, http.StatusForbidden)
	}
}

func TestCSRF_POSTWithValidOriginPasses(t *testing.T) {
	handler := CSRFProtection([]string{"https://app.kiramopay.com"})(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
		}),
	)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/sinpe/send", nil)
	req.Header.Set("Origin", "https://app.kiramopay.com")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("POST with valid Origin: got status %d, want %d", rec.Code, http.StatusOK)
	}
}

func TestCSRF_POSTWithAttackerOriginForbidden(t *testing.T) {
	handler := CSRFProtection([]string{"https://app.kiramopay.com"})(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
		}),
	)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/sinpe/send", nil)
	req.Header.Set("Origin", "https://evil.com")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Errorf("POST with attacker Origin: got status %d, want %d", rec.Code, http.StatusForbidden)
	}
}

func TestCSRF_OPTIONSAlwaysPasses(t *testing.T) {
	handler := CSRFProtection([]string{"https://app.kiramopay.com"})(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
		}),
	)

	req := httptest.NewRequest(http.MethodOptions, "/api/v1/sinpe/send", nil)
	req.Header.Set("Origin", "https://evil.com")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("OPTIONS: got status %d, want %d", rec.Code, http.StatusOK)
	}
}
