package database

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/exaring/otelpgx"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/kiramopay/backend/internal/config"
)

// NewPostgresPool builds a pgx pool. If DATABASE_URL is set it takes priority
// over the individual DB_* fields — this is how managed providers (Neon,
// Supabase, Railway, RDS) usually hand you the connection string.
func NewPostgresPool(cfg config.DatabaseConfig) (*pgxpool.Pool, error) {
	dsn := cfg.DSN()
	if envURL := os.Getenv("DATABASE_URL"); envURL != "" {
		dsn = envURL
	}

	poolCfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return nil, fmt.Errorf("parse database config: %w", err)
	}

	// Attach the OpenTelemetry pgx tracer. It emits DB spans only when a real
	// tracer provider is installed (observability.Init); otherwise the global
	// no-op provider makes this effectively free.
	poolCfg.ConnConfig.Tracer = otelpgx.NewTracer()

	poolCfg.MaxConns = int32(cfg.MaxConns) // #nosec G115 -- pool size is a small operator-set config value
	poolCfg.MinConns = 5
	poolCfg.MaxConnLifetime = 30 * time.Minute
	poolCfg.MaxConnIdleTime = 5 * time.Minute
	poolCfg.HealthCheckPeriod = 30 * time.Second

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	pool, err := pgxpool.NewWithConfig(ctx, poolCfg)
	if err != nil {
		return nil, fmt.Errorf("create connection pool: %w", err)
	}

	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping database: %w", err)
	}

	return pool, nil
}

// VerifyEncryptionKey fails fast when the PII-at-rest encryption key is not
// configured on the connected database. Migration 024 encrypts cedula/phone/
// email using a secret read from the `kiramopay.encryption_key` GUC, set once
// via `ALTER DATABASE <db> SET kiramopay.encryption_key = '<32+ chars>'`. If it
// is missing, every PII read/write raises at runtime; surfacing it at boot turns
// a scattered runtime failure into one clear startup error. current_setting's
// missing_ok=true form returns empty instead of raising when the GUC is unset.
func VerifyEncryptionKey(ctx context.Context, pool *pgxpool.Pool) error {
	var key string
	if err := pool.QueryRow(ctx,
		`SELECT COALESCE(current_setting('kiramopay.encryption_key', true), '')`,
	).Scan(&key); err != nil {
		return fmt.Errorf("read kiramopay.encryption_key GUC: %w", err)
	}
	if len(key) < 32 {
		return fmt.Errorf("kiramopay.encryption_key GUC is unset or shorter than 32 chars; " +
			"set it once with: ALTER DATABASE <db> SET kiramopay.encryption_key = '<32+ char secret>'")
	}
	return nil
}
