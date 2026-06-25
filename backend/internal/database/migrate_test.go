package database

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestHasNoTransactionDirective(t *testing.T) {
	cases := []struct {
		name string
		body string
		want bool
	}{
		{"directive at top", "-- migrate:no-transaction\nCREATE INDEX CONCURRENTLY i ON t (c);", true},
		{"directive with surrounding whitespace/blank lines", "\n  -- migrate:no-transaction  \n\nSELECT 1;", true},
		{"no directive", "CREATE TABLE t (id int);", false},
		{"similar but not an exact line", "-- migrate:no-transaction please\nSELECT 1;", false},
		{"mention buried in a longer comment", "-- this is not -- migrate:no-transaction\nSELECT 1;", false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := hasNoTransactionDirective([]byte(c.body)); got != c.want {
				t.Errorf("hasNoTransactionDirective(%q) = %v, want %v", c.body, got, c.want)
			}
		})
	}
}

func TestLockTimeoutMS(t *testing.T) {
	cases := []struct {
		name string
		env  string
		want int
	}{
		{"empty falls back to default", "", defaultLockTimeoutMS},
		{"explicit value", "5000", 5000},
		{"zero disables", "0", 0},
		{"negative falls back to default", "-1", defaultLockTimeoutMS},
		{"invalid falls back to default", "abc", defaultLockTimeoutMS},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			t.Setenv("MIGRATION_LOCK_TIMEOUT_MS", c.env)
			if got := lockTimeoutMS(); got != c.want {
				t.Errorf("lockTimeoutMS() env=%q = %d, want %d", c.env, got, c.want)
			}
		})
	}
}

// TestRunMigrationsNonTransactional verifies that a `-- migrate:no-transaction`
// migration runs WITHOUT a surrounding transaction — proven by a successful
// CREATE INDEX CONCURRENTLY, which Postgres rejects inside a transaction block.
// It runs against a throwaway database so it never touches the shared test DB.
func TestRunMigrationsNonTransactional(t *testing.T) {
	pool, cleanup := freshMigrationDB(t)
	defer cleanup()
	ctx := context.Background()

	dir := t.TempDir()
	writeMigration(t, dir, "001_table.sql", "CREATE TABLE widgets (id INT PRIMARY KEY, name TEXT);")
	writeMigration(t, dir, "002_index.sql",
		"-- migrate:no-transaction\nCREATE INDEX CONCURRENTLY IF NOT EXISTS idx_widgets_name ON widgets (name);")

	if err := RunMigrations(ctx, pool, dir); err != nil {
		t.Fatalf("RunMigrations: %v", err)
	}

	var applied int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM schema_migrations`).Scan(&applied); err != nil {
		t.Fatalf("count schema_migrations: %v", err)
	}
	if applied != 2 {
		t.Fatalf("expected 2 applied migrations, got %d", applied)
	}

	var idx int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM pg_indexes WHERE indexname = 'idx_widgets_name'`).Scan(&idx); err != nil {
		t.Fatalf("check index: %v", err)
	}
	if idx != 1 {
		t.Fatalf("expected the CONCURRENTLY index to exist, got %d", idx)
	}

	// Re-running is a clean no-op (applied-tracking is idempotent for both paths).
	if err := RunMigrations(ctx, pool, dir); err != nil {
		t.Fatalf("second run not idempotent: %v", err)
	}
}

func writeMigration(t *testing.T, dir, name, body string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o600); err != nil {
		t.Fatalf("write %s: %v", name, err)
	}
}

// freshMigrationDB creates a throwaway database (derived from TEST_DB_DSN) so
// migration-runner tests never mutate the shared integration database. Returns
// a pool to it plus a cleanup that drops it. Skips when TEST_DB_DSN is unset.
func freshMigrationDB(t *testing.T) (*pgxpool.Pool, func()) {
	t.Helper()
	dsn := os.Getenv("TEST_DB_DSN")
	if dsn == "" {
		t.Skip("set TEST_DB_DSN to run migration-runner integration tests")
	}
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatalf("parse TEST_DB_DSN: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	const dbName = "kiramopay_migrunner_test"
	adminCfg := cfg.Copy()
	adminCfg.ConnConfig.Database = "postgres"
	admin, err := pgxpool.NewWithConfig(ctx, adminCfg)
	if err != nil {
		t.Skipf("cannot connect to maintenance DB: %v", err)
	}
	// dbName is a compile-time constant; DDL identifiers cannot be parameterized.
	if _, err := admin.Exec(ctx, `DROP DATABASE IF EXISTS `+dbName+` WITH (FORCE)`); err != nil { // #nosec G202
		admin.Close()
		t.Fatalf("drop pre-existing %s: %v", dbName, err)
	}
	if _, err := admin.Exec(ctx, `CREATE DATABASE `+dbName); err != nil { // #nosec G202
		admin.Close()
		t.Fatalf("create %s: %v", dbName, err)
	}

	testCfg := cfg.Copy()
	testCfg.ConnConfig.Database = dbName
	pool, err := pgxpool.NewWithConfig(context.Background(), testCfg)
	if err != nil {
		admin.Close()
		t.Fatalf("connect to %s: %v", dbName, err)
	}

	cleanup := func() {
		pool.Close()
		ctx2, cancel2 := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel2()
		_, _ = admin.Exec(ctx2, `DROP DATABASE IF EXISTS `+dbName+` WITH (FORCE)`) // #nosec G202
		admin.Close()
	}
	return pool, cleanup
}
