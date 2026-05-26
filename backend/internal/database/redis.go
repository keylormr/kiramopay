package database

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/kiramopay/backend/internal/config"
	"github.com/redis/go-redis/v9"
)

// NewRedisClient builds the Redis client. If REDIS_URL is set it takes
// priority over the individual REDIS_* fields. Upstash hands you a
// rediss://default:password@host:6379 URL — using ParseURL automatically
// enables TLS for that scheme.
func NewRedisClient(cfg config.RedisConfig) (*redis.Client, error) {
	var client *redis.Client

	if url := os.Getenv("REDIS_URL"); url != "" {
		opts, err := redis.ParseURL(url)
		if err != nil {
			return nil, fmt.Errorf("parse REDIS_URL: %w", err)
		}
		client = redis.NewClient(opts)
	} else {
		client = redis.NewClient(&redis.Options{
			Addr:     cfg.Addr(),
			Password: cfg.Password,
			DB:       cfg.DB,
		})
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := client.Ping(ctx).Err(); err != nil {
		return nil, fmt.Errorf("ping redis: %w", err)
	}

	return client, nil
}
