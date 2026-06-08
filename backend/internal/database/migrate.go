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
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

// RunMigrations applies any pending *.sql files from `dir` to the database,
// tracking applied filenames + checksums in a `schema_migrations` table.
//
// Designed for managed Postgres (Neon, RDS, etc) where we cannot mount files
// into docker-entrypoint-initdb.d. Run from the API container on boot when
// RUN_MIGRATIONS=true.
//
// Ordering: files are applied in lexical order (001_*, 002_*, …). The `down/`
// subdirectory is intentionally skipped.
//
// Each file is applied inside a single transaction so a failure leaves the DB
// at the last good migration.
func RunMigrations(ctx context.Context, pool *pgxpool.Pool, dir string) error {
	if _, err := pool.Exec(ctx, `
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
	rows, err := pool.Query(ctx, `SELECT filename, checksum FROM schema_migrations`)
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

		logger.Info("applying migration", "file", name)
		tx, err := pool.Begin(ctx)
		if err != nil {
			return fmt.Errorf("begin tx for %s: %w", name, err)
		}
		if _, err := tx.Exec(ctx, string(body)); err != nil {
			_ = tx.Rollback(ctx)
			return fmt.Errorf("apply %s: %w", name, err)
		}
		if _, err := tx.Exec(ctx,
			`INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)`,
			name, sum,
		); err != nil {
			_ = tx.Rollback(ctx)
			return fmt.Errorf("record %s in schema_migrations: %w", name, err)
		}
		if err := tx.Commit(ctx); err != nil {
			return fmt.Errorf("commit %s: %w", name, err)
		}
		logger.Info("migration applied", "file", name)
	}

	return nil
}

func checksum(b []byte) string {
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:])
}
