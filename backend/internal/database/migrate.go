package database

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

// noTxDirective marks a migration that must NOT be wrapped in a transaction —
// required for statements like CREATE INDEX CONCURRENTLY, which Postgres rejects
// inside a transaction block. A no-transaction migration MUST be idempotent and
// SHOULD contain a single statement: a multi-statement simple query is itself an
// implicit transaction, which would defeat the purpose. See
// ZERO_DOWNTIME_MIGRATIONS.md.
const noTxDirective = "-- migrate:no-transaction"

// migrationLockKey is a fixed advisory-lock key so that at most one process
// applies migrations at a time. Other instances booting concurrently block on
// it, then find every migration already applied and do nothing. The value is
// arbitrary; only the migration runner uses it.
const migrationLockKey int64 = 7_240_193_845_120_557

// defaultLockTimeoutMS bounds how long a migration waits to ACQUIRE a lock (not
// how long it holds one). A blocking DDL then fails fast instead of queueing
// behind a long query and stalling all traffic on that table. Override with
// MIGRATION_LOCK_TIMEOUT_MS; set it to 0 to disable.
const defaultLockTimeoutMS = 3000

// RunMigrations applies any pending *.sql files from `dir` to the database,
// tracking applied filenames + checksums in a `schema_migrations` table.
//
// Designed for managed Postgres (Neon, RDS, etc) where we cannot mount files
// into docker-entrypoint-initdb.d. Run from the API container on boot when
// RUN_MIGRATIONS=true.
//
// The whole run holds a session advisory lock so concurrent instances serialize
// (single-runner gate), and a lock_timeout is set so a blocking DDL fails fast
// rather than stalling traffic.
//
// Ordering: files are applied in lexical order (001_*, 002_*, …). The `down/`
// subdirectory is intentionally skipped.
//
// Each file is applied inside a single transaction so a failure leaves the DB
// at the last good migration — UNLESS the file opts out with the
// `-- migrate:no-transaction` directive (for CREATE INDEX CONCURRENTLY), in
// which case it runs without a surrounding transaction and must be idempotent.
func RunMigrations(ctx context.Context, pool *pgxpool.Pool, dir string) error {
	// A dedicated connection holds the advisory lock and carries the session
	// lock_timeout for the whole run; every migration executes on it.
	conn, err := pool.Acquire(ctx)
	if err != nil {
		return fmt.Errorf("acquire migration conn: %w", err)
	}
	// Single-runner gate: block until we own the migration lock. A concurrent
	// instance waits here, then finds everything applied below.
	if _, err := conn.Exec(ctx, `SELECT pg_advisory_lock($1)`, migrationLockKey); err != nil {
		conn.Release()
		return fmt.Errorf("acquire migration advisory lock: %w", err)
	}
	// The lock is now held; release it and the connection on every exit path.
	lockTimeoutSet := false
	defer func() { releaseMigrationConn(conn, lockTimeoutSet) }()

	if ms := lockTimeoutMS(); ms > 0 {
		// #nosec G201 -- ms is a validated non-negative integer, not user input.
		if _, err := conn.Exec(ctx, fmt.Sprintf(`SET lock_timeout = %d`, ms)); err != nil {
			return fmt.Errorf("set lock_timeout: %w", err)
		}
		lockTimeoutSet = true
	}

	if _, err := conn.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS schema_migrations (
			filename     TEXT PRIMARY KEY,
			checksum     TEXT NOT NULL,
			applied_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)
	`); err != nil {
		return fmt.Errorf("create schema_migrations: %w", err)
	}

	entries, err := os.ReadDir(dir)
	if err != nil {
		return fmt.Errorf("read migrations dir %q: %w", dir, err)
	}

	files := make([]string, 0, len(entries))
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		name := e.Name()
		if !strings.HasSuffix(name, ".sql") {
			continue
		}
		files = append(files, name)
	}
	sort.Strings(files)

	applied := map[string]string{}
	rows, err := conn.Query(ctx, `SELECT filename, checksum FROM schema_migrations`)
	if err != nil {
		return fmt.Errorf("select applied migrations: %w", err)
	}
	for rows.Next() {
		var name, sum string
		if err := rows.Scan(&name, &sum); err != nil {
			rows.Close()
			return fmt.Errorf("scan applied migration: %w", err)
		}
		applied[name] = sum
	}
	rows.Close()

	logger := slog.Default().With("component", "migrate")

	for _, name := range files {
		full := filepath.Join(dir, name)
		body, err := os.ReadFile(full) // #nosec G304 -- migration filenames come from the trusted migrations dir listing, not user input
		if err != nil {
			return fmt.Errorf("read %s: %w", name, err)
		}
		sum := checksum(body)

		if prev, ok := applied[name]; ok {
			if prev != sum {
				// File changed after being applied — bail loudly. Editing
				// a migration that already ran is a footgun; force the
				// operator to add a NEW migration instead.
				return fmt.Errorf("migration %s was modified after being applied (checksum mismatch). Add a new migration instead of editing", name)
			}
			continue
		}

		noTx := hasNoTransactionDirective(body)
		logger.Info("applying migration", "file", name, "transactional", !noTx)
		if noTx {
			if err := applyNoTx(ctx, conn, name, string(body), sum); err != nil {
				return err
			}
		} else {
			if err := applyTx(ctx, conn, name, string(body), sum); err != nil {
				return err
			}
		}
		logger.Info("migration applied", "file", name)
	}

	return nil
}

// releaseMigrationConn unwinds the migration connection: it resets the session
// lock_timeout (if set), releases the advisory lock, and returns the connection
// to the pool. If the advisory unlock fails the lock could otherwise linger on
// a pooled connection and block every future migration run, so the connection
// is destroyed instead — ending its session, which makes PostgreSQL drop the
// lock automatically.
func releaseMigrationConn(conn *pgxpool.Conn, resetLockTimeout bool) {
	bg := context.Background()
	if resetLockTimeout {
		_, _ = conn.Exec(bg, `RESET lock_timeout`)
	}
	if _, err := conn.Exec(bg, `SELECT pg_advisory_unlock($1)`, migrationLockKey); err != nil {
		slog.Default().With("component", "migrate").
			Warn("migration advisory unlock failed; discarding connection", "error", err)
		_ = conn.Hijack().Close(bg)
		return
	}
	conn.Release()
}

// applyTx runs a migration and records it atomically in one transaction, so a
// failure rolls back cleanly to the last good migration.
func applyTx(ctx context.Context, conn *pgxpool.Conn, name, body, sum string) error {
	tx, err := conn.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx for %s: %w", name, err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	if _, err := tx.Exec(ctx, body); err != nil {
		return fmt.Errorf("apply %s: %w", name, err)
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)`,
		name, sum,
	); err != nil {
		return fmt.Errorf("record %s in schema_migrations: %w", name, err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit %s: %w", name, err)
	}
	return nil
}

// applyNoTx runs a `-- migrate:no-transaction` migration WITHOUT a surrounding
// transaction (for CREATE INDEX CONCURRENTLY etc). Because the body and the
// bookkeeping INSERT are not atomic, the migration MUST be idempotent: if it
// fails after partial work it is not recorded and will be retried next run.
func applyNoTx(ctx context.Context, conn *pgxpool.Conn, name, body, sum string) error {
	if _, err := conn.Exec(ctx, body); err != nil {
		return fmt.Errorf("apply %s (no-transaction): %w", name, err)
	}
	if _, err := conn.Exec(ctx,
		`INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)`,
		name, sum,
	); err != nil {
		return fmt.Errorf("record %s in schema_migrations: %w", name, err)
	}
	return nil
}

// hasNoTransactionDirective reports whether the migration opts out of the
// per-file transaction wrap via a standalone `-- migrate:no-transaction` line.
func hasNoTransactionDirective(body []byte) bool {
	for _, line := range strings.Split(string(body), "\n") {
		if strings.TrimSpace(line) == noTxDirective {
			return true
		}
	}
	return false
}

// lockTimeoutMS reads MIGRATION_LOCK_TIMEOUT_MS (milliseconds). A missing or
// invalid value falls back to the default; a negative value disables the guard.
func lockTimeoutMS() int {
	v := os.Getenv("MIGRATION_LOCK_TIMEOUT_MS")
	if v == "" {
		return defaultLockTimeoutMS
	}
	ms, err := strconv.Atoi(v)
	if err != nil || ms < 0 {
		return defaultLockTimeoutMS
	}
	return ms
}

func checksum(b []byte) string {
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:])
}
