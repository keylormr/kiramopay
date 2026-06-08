package kyc_test

import (
	"context"
	"testing"

	"github.com/kiramopay/backend/internal/kyc"
	"github.com/kiramopay/backend/internal/testutil"
	"github.com/kiramopay/backend/pkg/hash"

	"github.com/jackc/pgx/v5/pgxpool"
)

func setupKYC(t *testing.T) (*kyc.Service, *pgxpool.Pool, string, string) {
	t.Helper()
	pool := testutil.TestDB(t)
	svc := kyc.NewService(kyc.NewRepository(pool), nil)

	pinHash, _ := hash.HashPin("Kiramopay2024!")
	userID := testutil.SeedTestUser(t, pool, "702650930", pinHash)
	adminID := testutil.SeedTestUser2(t, pool)
	return svc, pool, userID, adminID
}

func TestKYC_SubmitClean_ThenApprove_RaisesLevelAndLimits(t *testing.T) {
	svc, pool, userID, adminID := setupKYC(t)
	ctx := context.Background()

	v, err := svc.Submit(ctx, userID, &kyc.SubmitRequest{
		LevelRequested: kyc.LevelComplete,
		FullLegalName:  "Test User",
		DocumentType:   "national_id",
		DocumentNumber: "702650930",
		Documents: []kyc.Document{
			{DocType: "id_front", FileRef: "s3://kyc/id_front.jpg", SHA256: "abc"},
		},
	}, "127.0.0.1")
	if err != nil {
		t.Fatalf("Submit() error: %v", err)
	}
	if v.Status != kyc.StatusPending || v.ScreeningResult != kyc.ScreenClean {
		t.Fatalf("expected pending/clean, got %s/%s", v.Status, v.ScreeningResult)
	}

	dv, err := svc.Decide(ctx, v.ID, adminID, &kyc.DecisionRequest{Approve: true}, "127.0.0.1")
	if err != nil {
		t.Fatalf("Decide() error: %v", err)
	}
	if dv.Status != kyc.StatusApproved {
		t.Fatalf("expected approved, got %s", dv.Status)
	}

	st, err := svc.GetStatus(ctx, userID)
	if err != nil {
		t.Fatalf("GetStatus() error: %v", err)
	}
	if st.KYCLevel != kyc.LevelComplete {
		t.Fatalf("expected level %d, got %d", kyc.LevelComplete, st.KYCLevel)
	}
	want := kyc.LevelLimits[kyc.LevelComplete]
	if st.Limits.DailyMinor != want.DailyMinor {
		t.Fatalf("status limits not raised: got %d want %d", st.Limits.DailyMinor, want.DailyMinor)
	}

	// Wallet limits actually persisted.
	var daily, monthly int64
	if err := pool.QueryRow(ctx,
		`SELECT daily_limit, monthly_limit FROM wallets WHERE user_id = $1::uuid`, userID,
	).Scan(&daily, &monthly); err != nil {
		t.Fatalf("read wallet limits: %v", err)
	}
	if daily != want.DailyMinor || monthly != want.MonthlyMinor {
		t.Fatalf("wallet limits not applied: daily=%d monthly=%d want %d/%d",
			daily, monthly, want.DailyMinor, want.MonthlyMinor)
	}
}

func TestKYC_SubmitSanctionedName_FlagsHit_AndCannotApprove(t *testing.T) {
	svc, _, userID, adminID := setupKYC(t)
	ctx := context.Background()

	v, err := svc.Submit(ctx, userID, &kyc.SubmitRequest{
		LevelRequested: kyc.LevelVerified,
		FullLegalName:  "Carlos Sancion Prueba", // seeded on the watchlist
		DocumentType:   "passport",
		DocumentNumber: "X1234567",
	}, "127.0.0.1")
	if err != nil {
		t.Fatalf("Submit() error: %v", err)
	}
	if v.Status != kyc.StatusScreeningHit || v.ScreeningResult != kyc.ScreenHit {
		t.Fatalf("expected screening_hit/hit, got %s/%s", v.Status, v.ScreeningResult)
	}

	if _, err := svc.Decide(ctx, v.ID, adminID, &kyc.DecisionRequest{Approve: true}, "127.0.0.1"); err == nil {
		t.Fatal("expected approval of a sanction hit to be refused")
	}
}

func TestKYC_ScreenIsClear(t *testing.T) {
	svc, _, _, _ := setupKYC(t)
	ctx := context.Background()

	clear, err := svc.ScreenIsClear(ctx, "Carlos Sancion Prueba")
	if err != nil {
		t.Fatalf("ScreenIsClear() error: %v", err)
	}
	if clear {
		t.Fatal("expected sanctioned name to NOT be clear")
	}

	clear, err = svc.ScreenIsClear(ctx, "Maria Inocente Rodriguez")
	if err != nil {
		t.Fatalf("ScreenIsClear() error: %v", err)
	}
	if !clear {
		t.Fatal("expected clean name to be clear")
	}
}
