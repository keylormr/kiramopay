package kyc

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestNamesMatch(t *testing.T) {
	cases := []struct {
		official string
		account  string
		want     bool
	}{
		{"JUAN CARLOS PEREZ MORA", "Juan Perez", true}, // account tokens are a subset
		{"MARIA JOSE RODRIGUEZ SOTO", "Maria Jose Rodriguez", true},
		{"JOSÉ PÉREZ", "jose perez", true},             // accent-insensitive
		{"ANA MARIA VARGAS", "Ana Solano", false},      // surname absent
		{"JUAN PEREZ", "", false},                      // empty account
		{"", "Juan Perez", false},                      // empty official
		{"CARLOS JIMENEZ NUÑEZ", "Carlos Nunez", true}, // ñ folded to n
	}
	for _, c := range cases {
		if got := namesMatch(c.official, c.account); got != c.want {
			t.Errorf("namesMatch(%q, %q) = %v, want %v", c.official, c.account, got, c.want)
		}
	}
}

func TestHaciendaLookupPrimary(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("identificacion") != "102340567" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"nombre":"JUAN PEREZ MORA","tipoIdentificacion":"01"}`))
	}))
	defer srv.Close()

	c := NewHaciendaClient(srv.URL, "http://127.0.0.1:0/unused")
	res, err := c.Lookup(context.Background(), "1-0234-0567") // dashes stripped
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if res.Name != "JUAN PEREZ MORA" || res.IDType != "national_id" || res.Source != "hacienda" {
		t.Fatalf("unexpected result: %+v", res)
	}

	// A second call for the same id is served from cache (server would 404 a
	// different id, so a cache miss here would surface as not-found).
	if _, err := c.Lookup(context.Background(), "102340567"); err != nil {
		t.Fatalf("cached lookup errored: %v", err)
	}
}

func TestLookupBusinessCedula_ReturnsRegisteredName(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("identificacion") != "3101100100" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"nombre":"CAFETERIA CENTRAL S.A.","tipoIdentificacion":"02"}`))
	}))
	defer srv.Close()

	// repo is unused by this path and the audit logger is nil-safe.
	s := NewService(nil, &Options{Hacienda: NewHaciendaClient(srv.URL, srv.URL)})
	res, err := s.LookupBusinessCedula(context.Background(), "user-1", "3-101-100100", "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if res.Name != "CAFETERIA CENTRAL S.A." {
		t.Fatalf("unexpected name: %+v", res)
	}
}

func TestLookupBusinessCedula_NotFound(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()

	s := NewService(nil, &Options{Hacienda: NewHaciendaClient(srv.URL, srv.URL)})
	if _, err := s.LookupBusinessCedula(context.Background(), "user-1", "399999999", ""); !errors.Is(err, ErrIdentityNotFound) {
		t.Fatalf("want ErrIdentityNotFound, got %v", err)
	}
}

func TestLookupBusinessCedula_NoProviderIsUnavailable(t *testing.T) {
	// Without a configured registry client the lookup must report unavailable
	// rather than panic — same nil-safe discipline as VerifyIdentity.
	s := NewService(nil, nil)
	if _, err := s.LookupBusinessCedula(context.Background(), "user-1", "3101100100", ""); !errors.Is(err, ErrIdentityUnavailable) {
		t.Fatalf("want ErrIdentityUnavailable, got %v", err)
	}
}

func TestHaciendaLookupNotFound(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()

	c := NewHaciendaClient(srv.URL, srv.URL)
	_, err := c.Lookup(context.Background(), "999999999")
	if !errors.Is(err, ErrIdentityNotFound) {
		t.Fatalf("want ErrIdentityNotFound, got %v", err)
	}
}

func TestHaciendaLookupFallback(t *testing.T) {
	// Primary is unreachable (5xx); fallback (gometa shape) answers.
	primary := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer primary.Close()
	fallback := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"results":[{"fullname":"ANA VARGAS SOLANO","guess_type":"fisico"}]}`))
	}))
	defer fallback.Close()

	c := NewHaciendaClient(primary.URL, fallback.URL)
	res, err := c.Lookup(context.Background(), "203450678")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if res.Name != "ANA VARGAS SOLANO" || res.Source != "gometa" {
		t.Fatalf("unexpected fallback result: %+v", res)
	}
}

func TestHaciendaLookupInvalidCedula(t *testing.T) {
	c := NewHaciendaClient("http://127.0.0.1:0", "http://127.0.0.1:0")
	if _, err := c.Lookup(context.Background(), "abc"); !errors.Is(err, ErrIdentityNotFound) {
		t.Fatalf("want ErrIdentityNotFound for invalid cedula, got %v", err)
	}
}
