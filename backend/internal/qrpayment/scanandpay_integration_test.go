package qrpayment_test

import (
	"context"
	"log/slog"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/kiramopay/backend/internal/ledger"
	"github.com/kiramopay/backend/internal/qrpayment"
	"github.com/kiramopay/backend/internal/testutil"
	"github.com/kiramopay/backend/internal/transaction"
	"github.com/kiramopay/backend/internal/wallet"
	"github.com/kiramopay/backend/pkg/hash"
)

func setupQR(t *testing.T) (*qrpayment.Service, *pgxpool.Pool, string, string) {
	t.Helper()
	pool := testutil.TestDB(t)
	l := ledger.NewEngine(pool, slog.New(slog.NewJSONHandler(os.Stdout, nil)))
	txSvc := transaction.NewService(transaction.NewRepository(pool), wallet.NewRepository(pool), l, nil)
	svc := qrpayment.NewService(qrpayment.NewRepository(pool), txSvc)
	pinHash, _ := hash.HashPin("Kiramopay2024!")
	payer := testutil.SeedTestUser(t, pool, "702650930", pinHash)
	owner := testutil.SeedTestUser2(t, pool)
	return svc, pool, payer, owner
}

func walletCRC(t *testing.T, pool *pgxpool.Pool, userID string) int64 {
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
		t.Fatalf("read fees: %v", err)
	}
	return bal
}

func countPaymentsByTx(t *testing.T, pool *pgxpool.Pool, txID string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM qr_payments WHERE tx_id = $1`, txID).Scan(&n); err != nil {
		t.Fatalf("count payments: %v", err)
	}
	return n
}

func verifiedMerchantQR(t *testing.T, svc *qrpayment.Service, owner string, amount int64) *qrpayment.QRPaymentCode {
	t.Helper()
	ctx := context.Background()
	m, err := svc.RegisterMerchant(ctx, owner, &qrpayment.RegisterMerchantRequest{
		Name: "Soda Tica", Category: "restaurant", Cedula: "3-101-123", CedulaType: "juridica", LegalName: "Soda Tica SA",
	})
	if err != nil {
		t.Fatalf("register merchant: %v", err)
	}
	if _, err := svc.ApproveMerchant(ctx, m.ID, owner); err != nil {
		t.Fatalf("approve merchant: %v", err)
	}
	qr, err := svc.CreateQRCode(ctx, owner, &qrpayment.CreateQRCodeRequest{
		Type: "merchant_fixed", Amount: amount, Currency: "CRC", MerchantID: m.ID,
	})
	if err != nil {
		t.Fatalf("create qr: %v", err)
	}
	return qr
}

// The merchant absorbs the 0.50% commission: payer pays the amount, merchant is
// credited amount-fee, the fee lands in SYSTEM:FEES — and a retried scan is fully
// idempotent (no extra money, no duplicate history row).
func TestScanAndPay_MerchantCommission_AndIdempotency(t *testing.T) {
	svc, pool, payer, owner := setupQR(t)
	ctx := context.Background()

	const amount int64 = 100000 // ₡1000.00
	const fee int64 = 500       // 0.50%
	qr := verifiedMerchantQR(t, svc, owner, amount)

	payer0, owner0, fees0 := walletCRC(t, pool, payer), walletCRC(t, pool, owner), feesCRC(t, pool)

	pay, err := svc.ScanAndPay(ctx, payer, &qrpayment.ScanQRPaymentRequest{QRData: qr.QRData, Currency: "CRC"})
	if err != nil {
		t.Fatalf("ScanAndPay: %v", err)
	}
	if pay.Fee != fee {
		t.Fatalf("payment fee = %d, want %d", pay.Fee, fee)
	}
	if got := walletCRC(t, pool, payer); got != payer0-amount {
		t.Fatalf("payer balance = %d, want %d", got, payer0-amount)
	}
	if got := walletCRC(t, pool, owner); got != owner0+amount-fee {
		t.Fatalf("merchant balance = %d, want %d", got, owner0+amount-fee)
	}
	if got := feesCRC(t, pool); got != fees0+fee {
		t.Fatalf("system fees = %d, want %d", got, fees0+fee)
	}

	// Retry the same scan: idempotent end to end.
	pay2, err := svc.ScanAndPay(ctx, payer, &qrpayment.ScanQRPaymentRequest{QRData: qr.QRData, Currency: "CRC"})
	if err != nil {
		t.Fatalf("ScanAndPay retry: %v", err)
	}
	if pay2.ID != pay.ID {
		t.Fatalf("retry returned a different payment id (%s vs %s)", pay2.ID, pay.ID)
	}
	if got := walletCRC(t, pool, payer); got != payer0-amount {
		t.Fatalf("payer balance moved on retry: %d", got)
	}
	if got := feesCRC(t, pool); got != fees0+fee {
		t.Fatalf("system fees moved on retry: %d", got)
	}
	if n := countPaymentsByTx(t, pool, pay.TxID); n != 1 {
		t.Fatalf("expected exactly 1 payment row for tx, got %d", n)
	}
}

// P2P codes carry no merchant, so they stay 1:1 with no commission.
func TestScanAndPay_P2P_NoCommission(t *testing.T) {
	svc, pool, payer, owner := setupQR(t)
	ctx := context.Background()

	qr, err := svc.CreateQRCode(ctx, owner, &qrpayment.CreateQRCodeRequest{
		Type: "p2p_receive", Amount: 50000, Currency: "CRC",
	})
	if err != nil {
		t.Fatalf("create p2p qr: %v", err)
	}

	payer0, owner0, fees0 := walletCRC(t, pool, payer), walletCRC(t, pool, owner), feesCRC(t, pool)

	pay, err := svc.ScanAndPay(ctx, payer, &qrpayment.ScanQRPaymentRequest{QRData: qr.QRData, Currency: "CRC"})
	if err != nil {
		t.Fatalf("ScanAndPay: %v", err)
	}
	if pay.Fee != 0 {
		t.Fatalf("p2p fee = %d, want 0", pay.Fee)
	}
	if got := walletCRC(t, pool, payer); got != payer0-50000 {
		t.Fatalf("payer balance = %d, want %d", got, payer0-50000)
	}
	if got := walletCRC(t, pool, owner); got != owner0+50000 {
		t.Fatalf("receiver balance = %d, want %d", got, owner0+50000)
	}
	if got := feesCRC(t, pool); got != fees0 {
		t.Fatalf("p2p must not touch fees: %d != %d", got, fees0)
	}
}

// A merchant QR code can only be created once the merchant is verified.
func TestCreateQRCode_RequiresVerifiedMerchant(t *testing.T) {
	svc, _, _, owner := setupQR(t)
	ctx := context.Background()

	m, err := svc.RegisterMerchant(ctx, owner, &qrpayment.RegisterMerchantRequest{
		Name: "Pending Co", Category: "retail", Cedula: "1-234-567", CedulaType: "fisica", LegalName: "Pending Co",
	})
	if err != nil {
		t.Fatalf("register: %v", err)
	}
	if _, err := svc.CreateQRCode(ctx, owner, &qrpayment.CreateQRCodeRequest{
		Type: "merchant_fixed", Amount: 1000, Currency: "CRC", MerchantID: m.ID,
	}); err == nil {
		t.Fatal("expected error creating a merchant QR for an unverified merchant")
	}
}

// A user cannot bind a QR code to a merchant they do not own.
func TestCreateQRCode_RejectsForeignMerchant(t *testing.T) {
	svc, _, payer, owner := setupQR(t)
	ctx := context.Background()

	m, err := svc.RegisterMerchant(ctx, owner, &qrpayment.RegisterMerchantRequest{
		Name: "Owner Co", Category: "services", Cedula: "2-345-678", CedulaType: "fisica", LegalName: "Owner Co",
	})
	if err != nil {
		t.Fatalf("register: %v", err)
	}
	if _, err := svc.ApproveMerchant(ctx, m.ID, owner); err != nil {
		t.Fatalf("approve: %v", err)
	}
	// payer (not the owner) tries to issue a code for owner's merchant.
	if _, err := svc.CreateQRCode(ctx, payer, &qrpayment.CreateQRCodeRequest{
		Type: "merchant_fixed", Amount: 1000, Currency: "CRC", MerchantID: m.ID,
	}); err == nil {
		t.Fatal("expected error: merchant does not belong to user")
	}
}
