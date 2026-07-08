package wallet_test

import (
	"context"
	"testing"

	"github.com/kiramopay/backend/internal/kyc"
	"github.com/kiramopay/backend/internal/testutil"
	"github.com/kiramopay/backend/internal/wallet"
	"github.com/kiramopay/backend/pkg/hash"
)

func setupWalletService(t *testing.T) (*wallet.Service, *wallet.Repository, string) {
	t.Helper()
	pool := testutil.TestDB(t)
	repo := wallet.NewRepository(pool)
	svc := wallet.NewService(repo)

	pinHash, _ := hash.HashPin("1234")
	userID := testutil.SeedTestUser(t, pool, "702650930", pinHash)

	return svc, repo, userID
}

func TestGetWallet_Success(t *testing.T) {
	svc, _, userID := setupWalletService(t)
	ctx := context.Background()

	w, err := svc.GetWallet(ctx, userID)
	if err != nil {
		t.Fatalf("GetWallet() error: %v", err)
	}
	if w == nil {
		t.Fatal("GetWallet() returned nil")
	}
	if w.UserID != userID {
		t.Fatalf("expected user_id %s, got %s", userID, w.UserID)
	}
	if w.Status != "active" {
		t.Fatalf("expected status active, got %s", w.Status)
	}
}

func TestGetBalance_Success(t *testing.T) {
	svc, _, userID := setupWalletService(t)
	ctx := context.Background()

	balance, err := svc.GetBalance(ctx, userID)
	if err != nil {
		t.Fatalf("GetBalance() error: %v", err)
	}
	if balance.CRC != 250000000 { // 2,500,000.00 CRC in centimos
		t.Fatalf("expected CRC balance 250000000, got %d", balance.CRC)
	}
	if balance.USD != 50000 { // 500.00 USD in cents
		t.Fatalf("expected USD balance 50000, got %d", balance.USD)
	}
}

func TestUpdateBalance_OptimisticLock(t *testing.T) {
	_, repo, userID := setupWalletService(t)
	ctx := context.Background()

	// Get current wallet
	w, err := repo.FindByUserID(ctx, userID)
	if err != nil {
		t.Fatalf("FindByUserID() error: %v", err)
	}

	// First update succeeds
	err = repo.UpdateBalance(ctx, w.ID, -100000, 0, w.Version)
	if err != nil {
		t.Fatalf("First UpdateBalance() error: %v", err)
	}

	// Second update with same version fails (optimistic lock)
	err = repo.UpdateBalance(ctx, w.ID, -100000, 0, w.Version)
	if err == nil {
		t.Fatal("expected optimistic lock error, got nil")
	}
}

func TestUpdateBalance_Debit(t *testing.T) {
	svc, repo, userID := setupWalletService(t)
	ctx := context.Background()

	w, err := svc.GetWallet(ctx, userID)
	if err != nil {
		t.Fatalf("GetWallet() error: %v", err)
	}

	initialBalance := w.BalanceCRC
	debitAmount := int64(50000000) // 500,000 CRC

	err = repo.UpdateBalance(ctx, w.ID, -debitAmount, 0, w.Version)
	if err != nil {
		t.Fatalf("UpdateBalance() error: %v", err)
	}

	balance, err := svc.GetBalance(ctx, userID)
	if err != nil {
		t.Fatalf("GetBalance() after debit error: %v", err)
	}

	expected := initialBalance - debitAmount
	if balance.CRC != expected {
		t.Fatalf("expected balance %d after debit, got %d", expected, balance.CRC)
	}
}

// A wallet created for a brand-new user must start at the KYC level-0 (Basic)
// limits, not the higher column default that used to leak the "Verified" tier
// to unverified accounts.
func TestCreateForUser_StartsAtBasicKYCLimits(t *testing.T) {
	pool := testutil.TestDB(t)
	repo := wallet.NewRepository(pool)
	ctx := context.Background()

	userID := "00000000-0000-0000-0000-0000000009a1"
	if _, err := pool.Exec(ctx,
		`INSERT INTO users (id, cedula_enc, cedula_hash, phone_enc, phone_hash,
		        first_name, last_name, password_hash, status, kyc_level)
		 VALUES ($1, fn_pii_encrypt('109990999'), fn_pii_hmac('109990999'),
		         fn_pii_encrypt('+50688887777'), fn_pii_hmac('+50688887777'),
		         'New', 'User', 'x', 'active', 0)`,
		userID,
	); err != nil {
		t.Fatalf("seed bare user: %v", err)
	}

	if err := repo.CreateForUser(ctx, userID); err != nil {
		t.Fatalf("CreateForUser() error: %v", err)
	}

	w, err := repo.FindByUserID(ctx, userID)
	if err != nil {
		t.Fatalf("FindByUserID() error: %v", err)
	}
	basic := kyc.LevelLimits[kyc.LevelBasic]
	if w.DailyLimit != basic.DailyMinor {
		t.Errorf("daily_limit = %d, want Basic tier %d", w.DailyLimit, basic.DailyMinor)
	}
	if w.MonthlyLimit != basic.MonthlyMinor {
		t.Errorf("monthly_limit = %d, want Basic tier %d", w.MonthlyLimit, basic.MonthlyMinor)
	}
}
