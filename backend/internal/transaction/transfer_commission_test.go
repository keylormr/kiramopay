package transaction_test

import (
	"context"
	"log/slog"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/kiramopay/backend/internal/ledger"
	"github.com/kiramopay/backend/internal/testutil"
	"github.com/kiramopay/backend/internal/transaction"
	"github.com/kiramopay/backend/internal/wallet"
	"github.com/kiramopay/backend/pkg/hash"
)

// setupTransferService seeds a payer (SeedTestUser) and a receiver/merchant
// (SeedTestUser2) and returns a transaction service backed by the real ledger.
func setupTransferService(t *testing.T) (*transaction.Service, *pgxpool.Pool, string, string) {
	t.Helper()
	pool := testutil.TestDB(t)
	l := ledger.NewEngine(pool, slog.New(slog.NewJSONHandler(os.Stdout, nil)))
	svc := transaction.NewService(transaction.NewRepository(pool), wallet.NewRepository(pool), l, nil)
	pinHash, _ := hash.HashPin("Kiramopay2024!")
	payer := testutil.SeedTestUser(t, pool, "702650930", pinHash)
	merchant := testutil.SeedTestUser2(t, pool)
	return svc, pool, payer, merchant
}

func crcWallet(t *testing.T, pool *pgxpool.Pool, userID string) int64 {
	t.Helper()
	var bal int64
	if err := pool.QueryRow(context.Background(),
		`SELECT balance_crc FROM wallets WHERE user_id = $1::uuid`, userID).Scan(&bal); err != nil {
		t.Fatalf("read wallet: %v", err)
	}
	return bal
}

func feesCRC(t *testing.T, pool *pgxpool.Pool) int64 {
	t.Helper()
	var bal int64
	if err := pool.QueryRow(context.Background(), `
		SELECT COALESCE(SUM(CASE WHEN je.direction = 'credit' THEN je.amount_minor ELSE -je.amount_minor END), 0)
		FROM journal_entries je
		JOIN ledger_accounts la ON la.id = je.account_id
		WHERE la.code = 'SYSTEM:FEES:CRC'`).Scan(&bal); err != nil {
		t.Fatalf("read system fees: %v", err)
	}
	return bal
}

// Merchant model: the payer pays exactly the amount, the merchant receives
// amount - fee, and the fee lands in SYSTEM:FEES.
func TestCreateTransfer_FeeFromReceiver_MerchantAbsorbs(t *testing.T) {
	svc, pool, payer, merchant := setupTransferService(t)
	ctx := context.Background()

	payer0, merch0, fees0 := crcWallet(t, pool, payer), crcWallet(t, pool, merchant), feesCRC(t, pool)

	const amount int64 = 100000 // ₡1000.00
	const fee int64 = 500       // 0.50%

	if _, _, err := svc.CreateTransfer(ctx, &transaction.CreateTransferRequest{
		FromUserID: payer, ToUserID: merchant, Amount: amount, Currency: "CRC",
		Fee: fee, FeeFromReceiver: true, IdempotencyKey: "qr-merchant-1",
		TxType: transaction.TypeQRPayment, ReceiveType: transaction.TypeQRReceive,
	}); err != nil {
		t.Fatalf("CreateTransfer: %v", err)
	}

	if got, want := crcWallet(t, pool, payer), payer0-amount; got != want {
		t.Fatalf("payer balance = %d, want %d (pays exactly the amount)", got, want)
	}
	if got, want := crcWallet(t, pool, merchant), merch0+amount-fee; got != want {
		t.Fatalf("merchant balance = %d, want %d (amount minus fee)", got, want)
	}
	if got, want := feesCRC(t, pool), fees0+fee; got != want {
		t.Fatalf("system fees = %d, want %d", got, want)
	}
}

// Back-compat: the classic payer-absorbed model is unchanged — payer pays
// amount + fee, receiver gets the full amount, fee lands in SYSTEM:FEES.
func TestCreateTransfer_FeePayerAbsorbed_BackCompat(t *testing.T) {
	svc, pool, payer, merchant := setupTransferService(t)
	ctx := context.Background()

	payer0, merch0, fees0 := crcWallet(t, pool, payer), crcWallet(t, pool, merchant), feesCRC(t, pool)

	const amount int64 = 100000
	const fee int64 = 500

	if _, _, err := svc.CreateTransfer(ctx, &transaction.CreateTransferRequest{
		FromUserID: payer, ToUserID: merchant, Amount: amount, Currency: "CRC",
		Fee: fee, FeeFromReceiver: false, IdempotencyKey: "payer-absorbed-1",
		TxType: transaction.TypeQRPayment, ReceiveType: transaction.TypeQRReceive,
	}); err != nil {
		t.Fatalf("CreateTransfer: %v", err)
	}

	if got, want := crcWallet(t, pool, payer), payer0-amount-fee; got != want {
		t.Fatalf("payer balance = %d, want %d (amount plus fee)", got, want)
	}
	if got, want := crcWallet(t, pool, merchant), merch0+amount; got != want {
		t.Fatalf("merchant balance = %d, want %d (full amount)", got, want)
	}
	if got, want := feesCRC(t, pool), fees0+fee; got != want {
		t.Fatalf("system fees = %d, want %d", got, want)
	}
}

// A receiver-absorbed fee that meets or exceeds the amount would leave a
// non-positive credit, which the ledger rejects — guard before posting.
func TestCreateTransfer_FeeFromReceiver_RejectsFeeGreaterEqualAmount(t *testing.T) {
	svc, _, payer, merchant := setupTransferService(t)
	if _, _, err := svc.CreateTransfer(context.Background(), &transaction.CreateTransferRequest{
		FromUserID: payer, ToUserID: merchant, Amount: 1000, Currency: "CRC",
		Fee: 1000, FeeFromReceiver: true, IdempotencyKey: "bad-fee-1",
		TxType: transaction.TypeQRPayment, ReceiveType: transaction.TypeQRReceive,
	}); err == nil {
		t.Fatal("expected error when fee >= amount")
	}
}
