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

func TestReconcileClean(t *testing.T) {
	pool := testutil.TestDB(t)
	_ = testutil.SeedTestUser(t, pool, "702650930", "dummy")
	ctx := context.Background()

	svc := reconcile.NewService(pool, nil, time.Hour, slog.New(slog.NewTextHandler(os.Stdout, nil)))
	rpt, err := svc.RunOnce(ctx)
	if err != nil {
		t.Fatalf("RunOnce: %v", err)
	}
	if rpt.WalletsBad != 0 {
		t.Fatalf("expected no drift on clean ledger, got %d bad wallets", rpt.WalletsBad)
	}
}
