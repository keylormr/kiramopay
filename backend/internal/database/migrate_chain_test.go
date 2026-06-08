package database

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// TestRunAllMigrations applies every migration file, in order, against the DB
// pointed to by MIGTEST_DSN — the same code path the backend runs on deploy
// (RUN_MIGRATIONS=true). It validates that the full chain applies cleanly,
// which is the deploy gate for the database layer.
//
// The target DB must have the `kiramopay.encryption_key` GUC set (migration 024
// requires it), mirroring the production prerequisite.
func TestRunAllMigrations(t *testing.T) {
	dsn := os.Getenv("MIGTEST_DSN")
	if dsn == "" {
		t.Skip("set MIGTEST_DSN to run the full migration-chain validation")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer pool.Close()

	if err := RunMigrations(ctx, pool, "../../migrations"); err != nil {
		t.Fatalf("migration chain failed: %v", err)
	}

	// Re-running must be a clean no-op (idempotent applied-tracking).
	if err := RunMigrations(ctx, pool, "../../migrations"); err != nil {
		t.Fatalf("second migration run not idempotent: %v", err)
	}
}
