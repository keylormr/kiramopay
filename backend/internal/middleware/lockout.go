package middleware

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/kiramopay/backend/pkg/response"
	"github.com/redis/go-redis/v9"
)

// LockoutStore abstracts lockout counter operations.
type LockoutStore interface {
	IncrLockout(key string) int64
	ResetLockout(key string)
	GetLockout(key string) int64
}

// RedisLockoutStore implements LockoutStore using Redis.
type RedisLockoutStore struct {
	client *redis.Client
	ttl    time.Duration
}

// NewRedisLockoutStore creates a new Redis-backed lockout store.
func NewRedisLockoutStore(client *redis.Client, ttl time.Duration) *RedisLockoutStore {
	return &RedisLockoutStore{client: client, ttl: ttl}
}

func (s *RedisLockoutStore) IncrLockout(key string) int64 {
	ctx := context.Background()
	count, err := s.client.Incr(ctx, key).Result()
	if err != nil {
		return 0
	}
	if count == 1 {
		s.client.Expire(ctx, key, s.ttl)
	}
	return count
}

func (s *RedisLockoutStore) ResetLockout(key string) {
	s.client.Del(context.Background(), key)
}

func (s *RedisLockoutStore) GetLockout(key string) int64 {
	val, err := s.client.Get(context.Background(), key).Int64()
	if err != nil {
		return 0
	}
	return val
}

// AccountLockoutCheck middleware blocks requests if the account has too many failed login attempts.
// It reads the request body to extract the cedula, then checks the lockout counter.
func AccountLockoutCheck(store LockoutStore, maxAttempts int) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Read body to get cedula
			body, err := io.ReadAll(r.Body)
			if err != nil {
				next.ServeHTTP(w, r)
				return
			}
			r.Body.Close()

			var req struct {
				Cedula string `json:"cedula"`
			}
			if err := json.Unmarshal(body, &req); err != nil || req.Cedula == "" {
				// Can't determine account - pass through and let handler validate
				r.Body = io.NopCloser(newBytesReader(body))
				next.ServeHTTP(w, r)
				return
			}

			key := fmt.Sprintf("lockout:%s", req.Cedula)
			count := store.GetLockout(key)

			if int(count) >= maxAttempts {
				response.Error(w, http.StatusLocked, "ACCOUNT_LOCKED",
					"account temporarily locked due to too many failed attempts")
				return
			}

			// Restore body for downstream handlers
			r.Body = io.NopCloser(newBytesReader(body))
			next.ServeHTTP(w, r)
		})
	}
}

// IncrementLockout increments the lockout counter for a cedula. Call on failed login.
func IncrementLockout(store LockoutStore, cedula string) {
	key := fmt.Sprintf("lockout:%s", cedula)
	store.IncrLockout(key)
}

// ResetLockout resets the lockout counter for a cedula. Call on successful login.
func ResetLockoutCounter(store LockoutStore, cedula string) {
	key := fmt.Sprintf("lockout:%s", cedula)
	store.ResetLockout(key)
}

type bytesReader struct {
	data []byte
	pos  int
}

func newBytesReader(data []byte) *bytesReader {
	return &bytesReader{data: data}
}

func (r *bytesReader) Read(p []byte) (int, error) {
	if r.pos >= len(r.data) {
		return 0, io.EOF
	}
	n := copy(p, r.data[r.pos:])
	r.pos += n
	return n, nil
}
