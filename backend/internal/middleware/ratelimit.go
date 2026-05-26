package middleware

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/kiramopay/backend/pkg/response"
	"github.com/redis/go-redis/v9"
)

// RateLimit is IP-based rate limiting for public endpoints.
func RateLimit(redisClient *redis.Client, limit int, window time.Duration) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ip := r.RemoteAddr
			key := fmt.Sprintf("ratelimit:%s", ip)

			ctx := context.Background()
			count, err := redisClient.Incr(ctx, key).Result()
			if err != nil {
				// If Redis is down, allow the request
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

// UserRateLimit is user-based rate limiting for authenticated endpoints.
// Uses userID from context as key; falls back to IP if no userID.
func UserRateLimit(redisClient *redis.Client, limit int, window time.Duration) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			userID := GetUserID(r.Context())
			key := fmt.Sprintf("userlimit:%s", userID)
			if userID == "" {
				key = fmt.Sprintf("userlimit:ip:%s", r.RemoteAddr)
			}

			ctx := context.Background()
			count, err := redisClient.Incr(ctx, key).Result()
			if err != nil {
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
