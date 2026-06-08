package uif_test

import (
	"context"
	"log/slog"
	"os"
	"testing"

	"github.com/kiramopay/backend/internal/ledger"
	"github.com/kiramopay/backend/internal/testutil"
	"github.com/kiramopay/backend/internal/transaction"
	"github.com/kiramopay/backend/internal/uif"
	"github.com/kiramopay/backend/internal/wallet"
	"github.com/kiramopay/backend/pkg/hash"

	"github.com/jackc/pgx/v5/pgxpool"
)

func setupUIF(t *testing.T) (*uif.Service, *transaction.Service, *pgxpool.Pool, string) {
	t.Helper()
	pool := testutil.TestDB(t)

	uifSvc := uif.NewService(uif.NewRepository(pool), nil)
	l := ledger.NewEngine(pool, slog.New(slog.NewJSONHandler(os.Stdout, nil)))
	txSvc := transaction.NewService(
		transaction.NewRepository(pool), wallet.NewRepository(pool), l,
		&transaction.Options{UIF: uifSvc},
	)

	pinHash, _ := hash.HashPin("Kiramopay2024!")
	userID := testutil.SeedTestUser(t, pool, "702650930", pinHash)

	// Headroom so large outgoing transactions clear balance/limit checks.
	if _, err := pool.Exec(context.Background(),
		`UPDATE wallets SET balance_crc = 100000000000,
		        daily_limit = 100000000000, monthly_limit = 100000000000
		 WHERE user_id = $1::uuid`, userID); err != nil {
		t.Fatalf("top up wallet: %v", err)
	}
	return uifSvc, txSvc, pool, userID
}

// A single outgoing transaction above the CRC ceiling (550M centimos) is
// flagged single_threshold, and a compliance officer can submit it.
func TestUIF_SingleThreshold_ThenReview(t *testing.T) {
	uifSvc, txSvc, _, userID := setupUIF(t)
	ctx := context.Background()

	if _, err := txSvc.CreateTransaction(ctx, userID, &transaction.CreateTransactionRequest{
		Type:           transaction.TypeSinpeSend,
		Amount:         600_000_000, // ₡6,000,000 >= 550M ceiling
		Currency:       "CRC",
		IdempotencyKey: "uif-single-1",
	}); err != nil {
		t.Fatalf("CreateTransaction: %v", err)
	}

	reports, err := uifSvc.ListReports(ctx, uif.StatusPending)
	if err != nil {
		t.Fatalf("ListReports: %v", err)
	}
	if len(reports) != 1 {
		t.Fatalf("expected 1 pending report, got %d", len(reports))
	}
	if reports[0].ReportType != uif.TypeSingleThreshold {
		t.Fatalf("expected single_threshold, got %s", reports[0].ReportType)
	}

	if err := uifSvc.ReviewReport(ctx, reports[0].ID, userID, &uif.ReviewRequest{
		Status: uif.StatusSubmitted, Notes: "reported to UIF",
	}); err != nil {
		t.Fatalf("ReviewReport: %v", err)
	}
	// No longer pending.
	pending, _ := uifSvc.ListReports(ctx, uif.StatusPending)
	if len(pending) != 0 {
		t.Fatalf("expected 0 pending after review, got %d", len(pending))
	}
	// A second review of the same report must fail.
	if err := uifSvc.ReviewReport(ctx, reports[0].ID, userID, &uif.ReviewRequest{Status: uif.StatusDismissed}); err == nil {
		t.Fatal("expected re-review of a settled report to fail")
	}
}

// Two transactions each below the ceiling but whose same-day total crosses it
// are flagged structuring on the transaction that crosses.
func TestUIF_Structuring_DetectedOnCrossingTx(t *testing.T) {
	uifSvc, txSvc, _, userID := setupUIF(t)
	ctx := context.Background()

	for i, key := range []string{"struct-1", "struct-2"} {
		if _, err := txSvc.CreateTransaction(ctx, userID, &transaction.CreateTransactionRequest{
			Type:           transaction.TypeSinpeSend,
			Amount:         300_000_000, // each ₡3,000,000 < 550M ceiling; sum 600M >= ceiling
			Currency:       "CRC",
			IdempotencyKey: key,
		}); err != nil {
			t.Fatalf("CreateTransaction #%d: %v", i, err)
		}
	}

	reports, err := uifSvc.ListReports(ctx, uif.StatusPending)
	if err != nil {
		t.Fatalf("ListReports: %v", err)
	}
	if len(reports) != 1 {
		t.Fatalf("expected exactly 1 structuring report, got %d", len(reports))
	}
	if reports[0].ReportType != uif.TypeStructuring {
		t.Fatalf("expected structuring, got %s", reports[0].ReportType)
	}
}

// A transaction below the ceiling with no prior daily activity produces no report.
func TestUIF_BelowThreshold_NoReport(t *testing.T) {
	uifSvc, txSvc, _, userID := setupUIF(t)
	ctx := context.Background()

	if _, err := txSvc.CreateTransaction(ctx, userID, &transaction.CreateTransactionRequest{
		Type:           transaction.TypeSinpeSend,
		Amount:         100_000_000, // ₡1,000,000 < ceiling
		Currency:       "CRC",
		IdempotencyKey: "below-1",
	}); err != nil {
		t.Fatalf("CreateTransaction: %v", err)
	}
	reports, _ := uifSvc.ListReports(ctx, uif.StatusPending)
	if len(reports) != 0 {
		t.Fatalf("expected no report below threshold, got %d", len(reports))
	}
}
