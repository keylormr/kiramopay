package middleware

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// mockRedisLockout simulates Redis for lockout tests.
type mockRedisLockout struct {
	counters map[string]int64
}

func newMockRedisLockout() *mockRedisLockout {
	return &mockRedisLockout{counters: make(map[string]int64)}
}

func (m *mockRedisLockout) IncrLockout(key string) int64 {
	m.counters[key]++
	return m.counters[key]
}

func (m *mockRedisLockout) ResetLockout(key string) {
	delete(m.counters, key)
}

func (m *mockRedisLockout) GetLockout(key string) int64 {
	return m.counters[key]
}

func TestLockout_AllowsFirstFourAttempts(t *testing.T) {
	store := newMockRedisLockout()
	handler := AccountLockoutCheck(store, 5)(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
		}),
	)

	for i := 0; i < 4; i++ {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", strings.NewReader(`{"cedula":"702650930"}`))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()

		// Simulate failed attempt by incrementing counter
		IncrementLockout(store, "702650930")
		handler.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Errorf("attempt %d: got %d, want %d", i+1, rec.Code, http.StatusOK)
		}
	}
}

func TestLockout_BlocksAfterFiveAttempts(t *testing.T) {
	store := newMockRedisLockout()
	handler := AccountLockoutCheck(store, 5)(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
		}),
	)

	// Simulate 5 failed attempts
	for i := 0; i < 5; i++ {
		IncrementLockout(store, "702650930")
	}

	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", strings.NewReader(`{"cedula":"702650930"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusLocked {
		t.Errorf("after 5 attempts: got %d, want %d", rec.Code, http.StatusLocked)
	}
}

func TestLockout_ResetsOnSuccessfulLogin(t *testing.T) {
	store := newMockRedisLockout()

	// Simulate 3 failed attempts
	for i := 0; i < 3; i++ {
		IncrementLockout(store, "702650930")
	}

	// Simulate successful login (reset)
	ResetLockoutCounter(store, "702650930")

	handler := AccountLockoutCheck(store, 5)(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
		}),
	)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", strings.NewReader(`{"cedula":"702650930"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("after reset: got %d, want %d", rec.Code, http.StatusOK)
	}
}

// El campo nuevo `identifier` y el alias legado `cedula` deben caer en el
// MISMO contador, incluso tecleados con formato distinto: la clave se
// construye sobre la forma canonica.
func TestLockout_IdentifierYFormatosCaenEnLaMismaCuenta(t *testing.T) {
	store := newMockRedisLockout()
	handler := AccountLockoutCheck(store, 5)(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
		}),
	)

	for i := 0; i < 5; i++ {
		IncrementLockout(store, "702650930")
	}

	cuerpos := []string{
		`{"identifier":"702650930"}`,
		`{"identifier":"7-0265-0930"}`,
		`{"cedula":"702650930"}`,
	}
	for _, cuerpo := range cuerpos {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", strings.NewReader(cuerpo))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusLocked {
			t.Errorf("cuerpo %s: dio %d, esperaba %d (423)", cuerpo, rec.Code, http.StatusLocked)
		}
	}

	// Un identificador DISTINTO no debe estar bloqueado.
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", strings.NewReader(`{"identifier":"88880001"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Errorf("otro identificador: dio %d, esperaba 200", rec.Code)
	}
}
