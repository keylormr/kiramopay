package database

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/exaring/otelpgx"
	"github.com/jackc/pgx/v5"
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

	// Set the PII encryption key as a session GUC on every connection so pgcrypto
	// fn_pii_* can encrypt/decrypt user PII at rest. Parameterized via set_config
	// (never string-interpolated). The key lives only in app config, never on disk.
	if key := cfg.PIIEncryptionKey; key != "" {
		poolCfg.AfterConnect = func(ctx context.Context, conn *pgx.Conn) error {
			_, err := conn.Exec(ctx, `SELECT set_config('kiramopay.encryption_key', $1, false)`, key)
			return err
		}
	}

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
