package transaction_test

import (
	"context"
	"log/slog"
	"os"
	"testing"

	"github.com/kiramopay/backend/internal/ledger"
	"github.com/kiramopay/backend/internal/testutil"
	"github.com/kiramopay/backend/internal/transaction"
	"github.com/kiramopay/backend/internal/wallet"
	"github.com/kiramopay/backend/pkg/hash"
)

func setupTxService(t *testing.T) (*transaction.Service, string) {
	t.Helper()
	pool := testutil.TestDB(t)
	txRepo := transaction.NewRepository(pool)
	walletRepo := wallet.NewRepository(pool)
	l := ledger.NewEngine(pool, slog.New(slog.NewJSONHandler(os.Stdout, nil)))
	svc := transaction.NewService(txRepo, walletRepo, l, nil)

	pinHash, _ := hash.HashPin("Kiramopay2024!")
	userID := testutil.SeedTestUser(t, pool, "702650930", pinHash)
	return svc, userID
}

func TestCreateTransaction_Deposit(t *testing.T) {
	svc, userID := setupTxService(t)
	ctx := context.Background()
	tx, err := svc.CreateTransaction(ctx, userID, &transaction.CreateTransactionRequest{
		Type: "deposit", Amount: 100000000, Currency: "CRC",
	})
	if err != nil {
		t.Fatalf("CreateTransaction: %v", err)
	}
	if tx.ID == "" || tx.Type != "deposit" || tx.Amount != 100000000 {
		t.Fatalf("unexpected tx %+v", tx)
	}
}

func TestCreateTransaction_SinpeSend(t *testing.T) {
	svc, userID := setupTxService(t)
	ctx := context.Background()
	tx, err := svc.CreateTransaction(ctx, userID, &transaction.CreateTransactionRequest{
		Type:              "sinpe_send",
		Amount:            5000000,
		Currency:          "CRC",
		Fee:               15000,
		CounterpartyName:  "Maria Lopez",
		CounterpartyPhone: "+50688885678",
		Description:       "Lunch payment",
	})
	if err != nil {
		t.Fatalf("CreateTransaction: %v", err)
	}
	if tx.Fee != 15000 || tx.CounterpartyName != "Maria Lopez" {
		t.Fatalf("unexpected tx %+v", tx)
	}
}

func TestCreateTransaction_IdempotencyShortCircuits(t *testing.T) {
	svc, userID := setupTxService(t)
	ctx := context.Background()
	req := &transaction.CreateTransactionRequest{
		Type: "deposit", Amount: 1000000, Currency: "CRC",
		IdempotencyKey: "tx-idem-1",
	}
	a, err := svc.CreateTransaction(ctx, userID, req)
	if err != nil {
		t.Fatalf("first create: %v", err)
	}
	b, err := svc.CreateTransaction(ctx, userID, req)
	if err != nil {
		t.Fatalf("second create: %v", err)
	}
	if a.ID != b.ID {
		t.Fatalf("idempotent retry must return same tx id (got %s vs %s)", a.ID, b.ID)
	}
}

func TestGetTransaction_Success(t *testing.T) {
	svc, userID := setupTxService(t)
	ctx := context.Background()
	created, err := svc.CreateTransaction(ctx, userID, &transaction.CreateTransactionRequest{
		Type: "deposit", Amount: 50000000, Currency: "CRC",
	})
	if err != nil {
		t.Fatalf("CreateTransaction: %v", err)
	}
	found, err := svc.GetTransaction(ctx, created.ID)
	if err != nil {
		t.Fatalf("GetTransaction: %v", err)
	}
	if found.ID != created.ID {
		t.Fatalf("id mismatch")
	}
}

func TestGetTransaction_NotFound(t *testing.T) {
	svc, _ := setupTxService(t)
	if _, err := svc.GetTransaction(context.Background(), "00000000-0000-0000-0000-000000000999"); err == nil {
		t.Fatal("expected error")
	}
}

func TestListTransactions_Pagination(t *testing.T) {
	svc, userID := setupTxService(t)
	ctx := context.Background()
	for i := 0; i < 5; i++ {
		if _, err := svc.CreateTransaction(ctx, userID, &transaction.CreateTransactionRequest{
			Type: "deposit", Amount: int64((i + 1) * 1000000), Currency: "CRC",
		}); err != nil {
			t.Fatalf("create #%d: %v", i, err)
		}
	}
	resp, err := svc.ListTransactions(ctx, userID, &transaction.ListTransactionsRequest{Limit: 2})
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if resp.Total != 5 {
		t.Fatalf("expected total 5, got %d", resp.Total)
	}
	if len(resp.Transactions) != 2 {
		t.Fatalf("expected page size 2, got %d", len(resp.Transactions))
	}
}

func TestListTransactions_FilterByType(t *testing.T) {
	svc, userID := setupTxService(t)
	ctx := context.Background()
	if _, err := svc.CreateTransaction(ctx, userID, &transaction.CreateTransactionRequest{
		Type: "deposit", Amount: 1000000, Currency: "CRC",
	}); err != nil {
		t.Fatalf("deposit: %v", err)
	}
	if _, err := svc.CreateTransaction(ctx, userID, &transaction.CreateTransactionRequest{
		Type: "sinpe_send", Amount: 500000, Currency: "CRC",
	}); err != nil {
		t.Fatalf("sinpe: %v", err)
	}
	resp, err := svc.ListTransactions(ctx, userID, &transaction.ListTransactionsRequest{
		Type: "deposit", Limit: 20,
	})
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if resp.Total != 1 {
		t.Fatalf("expected 1 deposit, got %d", resp.Total)
	}
}
