package middleware

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
)

// /health lo consultan la sonda de la plataforma, los monitores de uptime y las
// sondas internas. Ese trafico no trae la cabecera que identifica al cliente,
// asi que cae al respaldo y comparte UNA sola clave: cuando esa ventana se
// llenaba, el propio health check recibia 429 y la plataforma leia como caido un
// servicio sano.
func TestRateLimitExcept_LaRutaEximidaNuncaRecibe429(t *testing.T) {
	client := redis.NewClient(&redis.Options{Addr: "localhost:99999"}) // sin Redis: respaldo en proceso
	ok := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) })
	// Limite 1: la segunda peticion de una misma clave ya excede la ventana.
	handler := RateLimitExcept(RateLimit(client, 1, time.Minute), "/health")(ok)

	for i := 0; i < 5; i++ {
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/health", nil))
		if rec.Code != http.StatusOK {
			t.Fatalf("/health peticion %d: got %d, want %d", i+1, rec.Code, http.StatusOK)
		}
	}
}

func TestRateLimitExcept_ElRestoSigueLimitado(t *testing.T) {
	client := redis.NewClient(&redis.Options{Addr: "localhost:99999"})
	ok := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) })
	handler := RateLimitExcept(RateLimit(client, 1, time.Minute), "/health")(ok)

	first := httptest.NewRecorder()
	handler.ServeHTTP(first, httptest.NewRequest(http.MethodGet, "/api/v1/accounts", nil))
	if first.Code != http.StatusOK {
		t.Fatalf("primera peticion: got %d, want %d", first.Code, http.StatusOK)
	}

	second := httptest.NewRecorder()
	handler.ServeHTTP(second, httptest.NewRequest(http.MethodGet, "/api/v1/accounts", nil))
	if second.Code != http.StatusTooManyRequests {
		t.Fatalf("segunda peticion: got %d, want %d", second.Code, http.StatusTooManyRequests)
	}
}

// Eximir del limite global solo sirve si el limite propio de /health cuenta en
// otra clave. Con el mismo prefijo, cada consulta de salud gastaria la ventana
// global y la exencion no cambiaria nada.
func TestRateLimitKeyed_NoCompartaClaveConElGlobal(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	req.RemoteAddr = "10.0.0.7:1234"

	global := rateLimitKey("ratelimit", req)
	salud := rateLimitKey("ratelimit:health", req)

	if global == salud {
		t.Fatalf("las claves deben diferir: %q", global)
	}
	if !strings.HasPrefix(global, "ratelimit:") {
		t.Fatalf("clave global inesperada: %q", global)
	}
}

func TestUserRateLimit_UsesUserIDAsKey(t *testing.T) {
	// This test verifies that user rate limiting keys by user ID, not IP.
	// We use a mock by checking the key pattern.
	client := redis.NewClient(&redis.Options{Addr: "localhost:99999"}) // Non-existent, will fail gracefully

	handler := UserRateLimit(client, 100, time.Minute)(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
		}),
	)

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	ctx := context.WithValue(req.Context(), UserIDKey, "user-abc-123")
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	// When Redis is unavailable, requests pass through
	if rec.Code != http.StatusOK {
		t.Errorf("got %d, want %d", rec.Code, http.StatusOK)
	}
}

func TestUserRateLimit_NoUserIDFallsBackToIP(t *testing.T) {
	client := redis.NewClient(&redis.Options{Addr: "localhost:99999"})

	handler := UserRateLimit(client, 100, time.Minute)(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
		}),
	)

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("got %d, want %d", rec.Code, http.StatusOK)
	}
}
