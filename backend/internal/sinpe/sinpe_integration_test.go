package sinpe_test

import (
	"context"
	"log/slog"
	"os"
	"testing"

	"github.com/kiramopay/backend/internal/ledger"
	"github.com/kiramopay/backend/internal/sinpe"
	"github.com/kiramopay/backend/internal/testutil"
	"github.com/kiramopay/backend/internal/transaction"
	"github.com/kiramopay/backend/internal/user"
	"github.com/kiramopay/backend/internal/wallet"
	"github.com/kiramopay/backend/pkg/hash"
)

func setupSinpeService(t *testing.T) (*sinpe.Service, string) {
	t.Helper()
	pool := testutil.TestDB(t)

	sinpeRepo := sinpe.NewRepository(pool)
	txRepo := transaction.NewRepository(pool)
	walletRepo := wallet.NewRepository(pool)
	userRepo := user.NewRepository(pool)

	l := ledger.NewEngine(pool, slog.New(slog.NewJSONHandler(os.Stdout, nil)))
	txService := transaction.NewService(txRepo, walletRepo, l, nil)
	svc := sinpe.NewService(sinpeRepo, txService, walletRepo, userRepo, nil)

	pinHash, _ := hash.HashPin("Kiramopay2024!")
	userID := testutil.SeedTestUser(t, pool, "702650930", pinHash)

	return svc, userID
}

func TestAddContact_Success(t *testing.T) {
	svc, userID := setupSinpeService(t)
	ctx := context.Background()
	contact, err := svc.AddContact(ctx, userID, "+50688885678", "Maria Lopez", "BAC")
	if err != nil {
		t.Fatalf("AddContact() error: %v", err)
	}
	if contact.Name != "Maria Lopez" || contact.Phone != "+50688885678" {
		t.Fatalf("unexpected contact %+v", contact)
	}
}

func TestAddContact_Duplicate(t *testing.T) {
	svc, userID := setupSinpeService(t)
	ctx := context.Background()
	if _, err := svc.AddContact(ctx, userID, "+50688885678", "Maria Lopez", "BAC"); err != nil {
		t.Fatalf("first AddContact: %v", err)
	}
	// ON CONFLICT updates name/bank, so this no longer errors. Instead verify
	// idempotent upsert behaviour.
	c2, err := svc.AddContact(ctx, userID, "+50688885678", "Maria L.", "BCR")
	if err != nil {
		t.Fatalf("second AddContact (upsert): %v", err)
	}
	if c2.Name != "Maria L." {
		t.Fatalf("expected name to upsert, got %s", c2.Name)
	}
}

func TestGetContacts_Success(t *testing.T) {
	svc, userID := setupSinpeService(t)
	ctx := context.Background()
	_, _ = svc.AddContact(ctx, userID, "+50688885678", "Maria Lopez", "BAC")
	_, _ = svc.AddContact(ctx, userID, "+50688889999", "Carlos Perez", "BCR")
	contacts, err := svc.GetContacts(ctx, userID)
	if err != nil {
		t.Fatalf("GetContacts: %v", err)
	}
	if len(contacts) != 2 {
		t.Fatalf("expected 2 contacts, got %d", len(contacts))
	}
}

func TestSend_Success(t *testing.T) {
	svc, userID := setupSinpeService(t)
	ctx := context.Background()
	resp, err := svc.Send(ctx, userID, &sinpe.SendRequest{
		Phone:       "+50688885678",
		Amount:      5000000,
		Description: "Test transfer",
	}, "")
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	if resp.TransactionID == "" {
		t.Fatal("empty tx id")
	}
}

func TestSend_InsufficientBalance(t *testing.T) {
	svc, userID := setupSinpeService(t)
	ctx := context.Background()
	if _, err := svc.Send(ctx, userID, &sinpe.SendRequest{
		Phone:       "+50688885678",
		Amount:      300000000,
		Description: "Too much",
	}, ""); err == nil {
		t.Fatal("expected insufficient-balance error")
	}
}

func TestGetHistory_Success(t *testing.T) {
	svc, userID := setupSinpeService(t)
	ctx := context.Background()
	if _, err := svc.Send(ctx, userID, &sinpe.SendRequest{
		Phone: "+50688885678", Amount: 1000000, Description: "Test",
	}, ""); err != nil {
		t.Fatalf("Send: %v", err)
	}
	history, err := svc.GetHistory(ctx, userID)
	if err != nil {
		t.Fatalf("GetHistory: %v", err)
	}
	if len(history) < 1 {
		t.Fatal("expected >= 1 history entry")
	}
}
