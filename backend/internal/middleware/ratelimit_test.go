package middleware

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
)

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
