package middleware

import (
	"context"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/kiramopay/backend/pkg/response"
	"github.com/redis/go-redis/v9"
)

// limiterIP keys rate-limit windows by the resolved client IP instead of the
// raw RemoteAddr. Behind the Render proxy RemoteAddr is the proxy's address
// plus an ephemeral port, so keying on it neither identified the client nor
// produced stable windows. When nothing parses, fall back to RemoteAddr so a
// request is never left without a key.
func limiterIP(r *http.Request) string {
	if ip := RequestIP(r); ip != "" {
		return ip
	}
	return r.RemoteAddr
}

// rateLimitKey namespaces a limiter window. Two limiters that must not consume
// each other's budget have to differ here — same prefix, same window.
func rateLimitKey(prefix string, r *http.Request) string {
	return fmt.Sprintf("%s:%s", prefix, limiterIP(r))
}

// inProcLimiter is a fixed-window in-process limiter used as a FAIL-DEGRADED
// fallback when Redis is unavailable, so rate limiting on sensitive routes does
// not silently disappear during a Redis outage. It is best-effort and
// per-process (not shared across replicas) — a backstop, not the primary limiter.
type inProcLimiter struct {
	mu      sync.Mutex
	windows map[string]*procWindow
}

type procWindow struct {
	count   int
	resetAt time.Time
}

func newInProcLimiter() *inProcLimiter {
	return &inProcLimiter{windows: make(map[string]*procWindow)}
}

// allow reports whether a request keyed by key is within limit for the window.
func (l *inProcLimiter) allow(key string, limit int, window time.Duration) bool {
	now := time.Now()
	l.mu.Lock()
	defer l.mu.Unlock()
	// Opportunistic cleanup so the map cannot grow without bound during an outage.
	if len(l.windows) > 10000 {
		for k, w := range l.windows {
			if now.After(w.resetAt) {
				delete(l.windows, k)
			}
		}
	}
	w := l.windows[key]
	if w == nil || now.After(w.resetAt) {
		l.windows[key] = &procWindow{count: 1, resetAt: now.Add(window)}
		return true
	}
	w.count++
	return w.count <= limit
}

// RateLimit is IP-based rate limiting for public endpoints.
func RateLimit(redisClient *redis.Client, limit int, window time.Duration) func(http.Handler) http.Handler {
	return RateLimitKeyed(redisClient, "ratelimit", limit, window)
}

// RateLimitKeyed is RateLimit under its own key namespace. A route that needs
// its own budget MUST use a distinct prefix: sharing "ratelimit" would make its
// requests consume the global window it was meant to be independent of.
func RateLimitKeyed(redisClient *redis.Client, prefix string, limit int, window time.Duration) func(http.Handler) http.Handler {
	fallback := newInProcLimiter()
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			key := rateLimitKey(prefix, r)

			ctx := context.Background()
			count, err := redisClient.Incr(ctx, key).Result()
			if err != nil {
				// Redis is down: fail DEGRADED to an in-process limiter rather
				// than open, so the brute-force/abuse backstop survives an outage.
				if !fallback.allow(key, limit, window) {
					response.Error(w, http.StatusTooManyRequests, "RATE_LIMITED", "too many requests, please try again later")
					return
				}
				next.ServeHTTP(w, r)
				return
			}

			if count == 1 {
				redisClient.Expire(ctx, key, window)
			}

			if count > int64(limit) {
				response.Error(w, http.StatusTooManyRequests, "RATE_LIMITED", "too many requests, please try again later")
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

// RateLimitExcept applies rl to every request except the listed exact paths.
//
// It exists for /health: the probes that call it (the platform's own check,
// uptime monitors, internal probes) arrive without the header that identifies
// the client, so they all fall back to a single limiter key — and share it with
// whatever real traffic lands on that same fallback. Once that window filled,
// the health check itself started getting 429 and the platform read a healthy
// service as down.
func RateLimitExcept(rl func(http.Handler) http.Handler, paths ...string) func(http.Handler) http.Handler {
	exempt := make(map[string]struct{}, len(paths))
	for _, p := range paths {
		exempt[p] = struct{}{}
	}
	return func(next http.Handler) http.Handler {
		limited := rl(next)
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if _, skip := exempt[r.URL.Path]; skip {
				next.ServeHTTP(w, r)
				return
			}
			limited.ServeHTTP(w, r)
		})
	}
}

// UserRateLimit is user-based rate limiting for authenticated endpoints.
// Uses userID from context as key; falls back to IP if no userID.
func UserRateLimit(redisClient *redis.Client, limit int, window time.Duration) func(http.Handler) http.Handler {
	fallback := newInProcLimiter()
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			userID := GetUserID(r.Context())
			key := fmt.Sprintf("userlimit:%s", userID)
			if userID == "" {
				key = fmt.Sprintf("userlimit:ip:%s", limiterIP(r))
			}

			ctx := context.Background()
			count, err := redisClient.Incr(ctx, key).Result()
			if err != nil {
				// Redis is down: fail DEGRADED to an in-process limiter, not open.
				if !fallback.allow(key, limit, window) {
					response.Error(w, http.StatusTooManyRequests, "RATE_LIMITED", "too many requests, please try again later")
					return
				}
				next.ServeHTTP(w, r)
				return
			}

			if count == 1 {
				redisClient.Expire(ctx, key, window)
			}

			if count > int64(limit) {
				response.Error(w, http.StatusTooManyRequests, "RATE_LIMITED", "too many requests, please try again later")
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}
