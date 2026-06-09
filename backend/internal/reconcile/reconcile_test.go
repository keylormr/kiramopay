package reconcile_test

import (
	"context"
	"log/slog"
	"os"
	"testing"
	"time"

	"github.com/kiramopay/backend/internal/reconcile"
	"github.com/kiramopay/backend/internal/testutil"
)

func TestReconcileDetectsDrift(t *testing.T) {
	pool := testutil.TestDB(t)
	userID := testutil.SeedTestUser(t, pool, "702650930", "dummy")
	ctx := context.Background()

	// The seed sets a cached balance with no matching journal entries; zero the
	// cache so the baseline matches the (empty) ledger before forcing drift.
	if _, err := pool.Exec(ctx,
		`UPDATE wallets SET balance_crc = 0, balance_usd = 0 WHERE user_id = $1::uuid`, userID,
	); err != nil {
		t.Fatalf("reset wallet: %v", err)
	}

	// Force drift: bump cached wallets.balance_crc without writing journal.
	if _, err := pool.Exec(ctx,
		`UPDATE wallets SET balance_crc = balance_crc + 5000 WHERE user_id = $1::uuid`,
		userID,
	); err != nil {
		t.Fatalf("force drift: %v", err)
	}

	svc := reconcile.NewService(pool, nil, time.Hour, slog.New(slog.NewTextHandler(os.Stdout, nil)))
	rpt, err := svc.RunOnce(ctx)
	if err != nil {
		t.Fatalf("RunOnce: %v", err)
	}
	if rpt.WalletsBad < 1 {
		t.Fatalf("expected drift detected, got %+v", rpt)
	}
	if rpt.DriftCRC != 5000 {
		t.Errorf("expected DriftCRC=5000, got %d", rpt.DriftCRC)
	}
}

func TestReconcileAutoFix(t *testing.T) {
	pool := testutil.TestDB(t)
	userID := testutil.SeedTestUser(t, pool, "702650930", "dummy")
	ctx := context.Background()

	// Clean baseline, then force a cache-only drift (no journal entries).
	if _, err := pool.Exec(ctx,
		`UPDATE wallets SET balance_crc = 7777, balance_usd = 0 WHERE user_id = $1::uuid`, userID,
	); err != nil {
		t.Fatalf("force drift: %v", err)
	}

	svc := reconcile.NewService(pool, nil, time.Hour,
		slog.New(slog.NewTextHandler(os.Stdout, nil)),
		reconcile.WithAutoFix(0)) // no cap
	rpt, err := svc.RunOnce(ctx)
	if err != nil {
		t.Fatalf("RunOnce: %v", err)
	}
	if rpt.WalletsFixed < 1 {
		t.Fatalf("expected a wallet fixed, got %+v", rpt)
	}
	if rpt.FixedDriftCRC != 7777 {
		t.Errorf("expected FixedDriftCRC=7777, got %d", rpt.FixedDriftCRC)
	}

	// Cache must now match the (empty) journal.
	var crc int64
	if err := pool.QueryRow(ctx,
		`SELECT balance_crc FROM wallets WHERE user_id = $1::uuid`, userID).Scan(&crc); err != nil {
		t.Fatalf("read wallet: %v", err)
	}
	if crc != 0 {
		t.Errorf("expected cache snapped to journal (0), got %d", crc)
	}

	// A second run sees a clean ledger — nothing left to fix.
	rpt2, err := svc.RunOnce(ctx)
	if err != nil {
		t.Fatalf("RunOnce#2: %v", err)
	}
	if rpt2.WalletsBad != 0 || rpt2.WalletsFixed != 0 {
		t.Errorf("expected clean second run, got %+v", rpt2)
	}
}

func TestReconcileAutoFixRespectsCap(t *testing.T) {
	pool := testutil.TestDB(t)
	userID := testutil.SeedTestUser(t, pool, "702650930", "dummy")
	ctx := context.Background()

	// Drift of 5,000 with a cap of 1,000 → must be left untouched.
	if _, err := pool.Exec(ctx,
		`UPDATE wallets SET balance_crc = 5000, balance_usd = 0 WHERE user_id = $1::uuid`, userID,
	); err != nil {
		t.Fatalf("force drift: %v", err)
	}

	svc := reconcile.NewService(pool, nil, time.Hour,
		slog.New(slog.NewTextHandler(os.Stdout, nil)),
		reconcile.WithAutoFix(1000))
	rpt, err := svc.RunOnce(ctx)
	if err != nil {
		t.Fatalf("RunOnce: %v", err)
	}
	if rpt.WalletsCapped < 1 {
		t.Fatalf("expected wallet capped, got %+v", rpt)
	}
	if rpt.WalletsFixed != 0 {
		t.Errorf("expected no fix above cap, got %d", rpt.WalletsFixed)
	}

	// Cache must be unchanged (still drifted, awaiting human review).
	var crc int64
	if err := pool.QueryRow(ctx,
		`SELECT balance_crc FROM wallets WHERE user_id = $1::uuid`, userID).Scan(&crc); err != nil {
		t.Fatalf("read wallet: %v", err)
	}
	if crc != 5000 {
		t.Errorf("expected drift left untouched (5000), got %d", crc)
	}
}

func TestReconcileClean(t *testing.T) {
	pool := testutil.TestDB(t)
	userID := testutil.SeedTestUser(t, pool, "702650930", "dummy")
	ctx := context.Background()

	// Zero the seeded cache so it matches the empty ledger (clean baseline).
	if _, err := pool.Exec(ctx,
		`UPDATE wallets SET balance_crc = 0, balance_usd = 0 WHERE user_id = $1::uuid`, userID,
	); err != nil {
		t.Fatalf("reset wallet: %v", err)
	}

	svc := reconcile.NewService(pool, nil, time.Hour, slog.New(slog.NewTextHandler(os.Stdout, nil)))
	rpt, err := svc.RunOnce(ctx)
	if err != nil {
		t.Fatalf("RunOnce: %v", err)
	}
	if rpt.WalletsBad != 0 {
		t.Fatalf("expected no drift on clean ledger, got %d bad wallets", rpt.WalletsBad)
	}
}
