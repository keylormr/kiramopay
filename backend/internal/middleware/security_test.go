package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestSecurityHeaders(t *testing.T) {
	handler := SecurityHeaders(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	tests := []struct {
		header string
		want   string
	}{
		{"X-Frame-Options", "DENY"},
		{"X-Content-Type-Options", "nosniff"},
		{"Referrer-Policy", "strict-origin-when-cross-origin"},
		{"Permissions-Policy", "camera=(), microphone=(), geolocation=()"},
		{"Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload"},
	}

	for _, tt := range tests {
		t.Run(tt.header, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/", nil)
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, req)

			got := rec.Header().Get(tt.header)
			if got != tt.want {
				t.Errorf("%s = %q, want %q", tt.header, got, tt.want)
			}
		})
	}
}

func TestSecurityHeadersCSP(t *testing.T) {
	handler := SecurityHeaders(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	csp := rec.Header().Get("Content-Security-Policy")
	if csp == "" {
		t.Fatal("Content-Security-Policy header missing")
	}

	// Should allow self for scripts and styles
	expectations := []string{"default-src 'self'", "connect-src 'self'"}
	for _, exp := range expectations {
		found := false
		for _, part := range splitCSP(csp) {
			if part == exp || contains(part, exp) {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("CSP missing directive containing %q, got: %s", exp, csp)
		}
	}
}

func splitCSP(csp string) []string {
	var parts []string
	current := ""
	for _, c := range csp {
		if c == ';' {
			parts = append(parts, trim(current))
			current = ""
		} else {
			current += string(c)
		}
	}
	if current != "" {
		parts = append(parts, trim(current))
	}
	return parts
}

func trim(s string) string {
	for len(s) > 0 && s[0] == ' ' {
		s = s[1:]
	}
	for len(s) > 0 && s[len(s)-1] == ' ' {
		s = s[:len(s)-1]
	}
	return s
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && searchStr(s, substr)
}

func searchStr(s, sub string) bool {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
