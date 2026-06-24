package crypto_test

import (
	"context"
	"log/slog"
	"os"
	"testing"

	"github.com/kiramopay/backend/internal/crypto"
	"github.com/kiramopay/backend/internal/ledger"
	"github.com/kiramopay/backend/internal/testutil"
	"github.com/kiramopay/backend/internal/transaction"
	"github.com/kiramopay/backend/internal/wallet"
	"github.com/kiramopay/backend/pkg/hash"
	"github.com/shopspring/decimal"
)

// d is a terse helper for decimal literals in test fixtures.
func d(f float64) decimal.Decimal { return decimal.NewFromFloat(f) }

func setupCryptoService(t *testing.T) (*crypto.Service, string) {
	t.Helper()
	pool := testutil.TestDB(t)

	repo := crypto.NewRepository(pool)
	priceService := crypto.NewPriceService()
	txRepo := transaction.NewRepository(pool)
	walletRepo := wallet.NewRepository(pool)
	l := ledger.NewEngine(pool, slog.New(slog.NewJSONHandler(os.Stdout, nil)))
	txService := transaction.NewService(txRepo, walletRepo, l, nil)
	svc := crypto.NewService(repo, priceService, txService)

	pinHash, _ := hash.HashPin("1234")
	userID := testutil.SeedTestUser(t, pool, "702650930", pinHash)

	// Crypto buys now debit fiat through the ledger; give the wallet enough
	// balance and limit headroom for the purchases exercised below.
	if _, err := pool.Exec(context.Background(),
		`UPDATE wallets SET balance_crc = 1000000000000,
		        daily_limit = 1000000000000, monthly_limit = 1000000000000
		 WHERE user_id = $1::uuid`, userID); err != nil {
		t.Fatalf("top up wallet: %v", err)
	}

	return svc, userID
}

func TestGetPrices(t *testing.T) {
	svc, _ := setupCryptoService(t)

	prices, err := svc.GetPrices(context.Background(), []string{"BTC", "ETH", "SOL"})
	if err != nil {
		t.Fatalf("GetPrices() error: %v", err)
	}
	if len(prices) != 3 {
		t.Fatalf("expected 3 prices, got %d", len(prices))
	}

	btc, ok := prices["BTC"]
	if !ok {
		t.Fatal("BTC not found in prices")
	}
	if btc.Price <= 0 {
		t.Fatalf("expected positive BTC price, got %f", btc.Price)
	}
}

func TestBuy_Success(t *testing.T) {
	svc, userID := setupCryptoService(t)
	ctx := context.Background()

	tx, err := svc.Buy(ctx, userID, &crypto.BuyRequest{
		Asset:        "BTC",
		Amount:       d(0.001),
		Price:        d(50000000),
		FromCurrency: "CRC",
		FromAmount:   d(50000),
	})
	if err != nil {
		t.Fatalf("Buy() error: %v", err)
	}
	if tx.Type != "buy" {
		t.Fatalf("expected type buy, got %s", tx.Type)
	}
	if tx.Asset != "BTC" {
		t.Fatalf("expected asset BTC, got %s", tx.Asset)
	}
}

func TestSell_Success(t *testing.T) {
	svc, userID := setupCryptoService(t)
	ctx := context.Background()

	// Buy first
	_, err := svc.Buy(ctx, userID, &crypto.BuyRequest{
		Asset:        "ETH",
		Amount:       d(1.0),
		Price:        d(3000000),
		FromCurrency: "CRC",
		FromAmount:   d(3000000),
	})
	if err != nil {
		t.Fatalf("Buy() error: %v", err)
	}

	// Sell
	tx, err := svc.Sell(ctx, userID, &crypto.SellRequest{
		Asset:      "ETH",
		Amount:     d(0.5),
		Price:      d(3000000),
		ToCurrency: "CRC",
		ToAmount:   d(1500000),
	})
	if err != nil {
		t.Fatalf("Sell() error: %v", err)
	}
	if tx.Type != "sell" {
		t.Fatalf("expected type sell, got %s", tx.Type)
	}
}

func TestGetAssets_Empty(t *testing.T) {
	svc, userID := setupCryptoService(t)
	ctx := context.Background()

	assets, err := svc.GetAssets(ctx, userID)
	if err != nil {
		t.Fatalf("GetAssets() error: %v", err)
	}
	if len(assets) != 0 {
		t.Fatalf("expected 0 assets for new user, got %d", len(assets))
	}
}

func TestGetAssets_AfterBuy(t *testing.T) {
	svc, userID := setupCryptoService(t)
	ctx := context.Background()

	_, err := svc.Buy(ctx, userID, &crypto.BuyRequest{
		Asset:        "BTC",
		Amount:       d(0.5),
		Price:        d(50000000),
		FromCurrency: "CRC",
		FromAmount:   d(25000000),
	})
	if err != nil {
		t.Fatalf("Buy() error: %v", err)
	}

	assets, err := svc.GetAssets(ctx, userID)
	if err != nil {
		t.Fatalf("GetAssets() error: %v", err)
	}
	if len(assets) < 1 {
		t.Fatal("expected at least 1 asset after buy")
	}
}

func TestStake_Success(t *testing.T) {
	svc, userID := setupCryptoService(t)
	ctx := context.Background()

	// Fund the asset first (staking requires an existing balance).
	if _, err := svc.Buy(ctx, userID, &crypto.BuyRequest{
		Asset: "ETH", Amount: d(2.0), Price: d(3000000), FromCurrency: "CRC", FromAmount: d(6000000),
	}); err != nil {
		t.Fatalf("seed buy: %v", err)
	}

	staking, err := svc.Stake(ctx, userID, &crypto.StakeRequest{
		Asset:    "ETH",
		Amount:   d(2.0),
		APY:      5.5,
		Locked:   true,
		LockDays: 30,
	})
	if err != nil {
		t.Fatalf("Stake() error: %v", err)
	}
	if staking.Asset != "ETH" {
		t.Fatalf("expected asset ETH, got %s", staking.Asset)
	}
	if staking.Status != "active" {
		t.Fatalf("expected status active, got %s", staking.Status)
	}
}

func TestUnstake_Success(t *testing.T) {
	svc, userID := setupCryptoService(t)
	ctx := context.Background()

	if _, err := svc.Buy(ctx, userID, &crypto.BuyRequest{
		Asset: "SOL", Amount: d(10.0), Price: d(50000), FromCurrency: "CRC", FromAmount: d(500000),
	}); err != nil {
		t.Fatalf("seed buy: %v", err)
	}

	staking, err := svc.Stake(ctx, userID, &crypto.StakeRequest{
		Asset:  "SOL",
		Amount: d(10.0),
		APY:    7.0,
	})
	if err != nil {
		t.Fatalf("Stake() error: %v", err)
	}

	err = svc.Unstake(ctx, userID, staking.ID)
	if err != nil {
		t.Fatalf("Unstake() error: %v", err)
	}
}

func TestPriceAlert_CRUD(t *testing.T) {
	svc, userID := setupCryptoService(t)
	ctx := context.Background()

	// Add alert
	alert, err := svc.AddPriceAlert(ctx, userID, &crypto.PriceAlertRecord{
		Asset:       "BTC",
		TargetPrice: d(100000),
		Direction:   "above",
	})
	if err != nil {
		t.Fatalf("AddPriceAlert() error: %v", err)
	}

	// List alerts
	alerts, err := svc.GetPriceAlerts(ctx, userID)
	if err != nil {
		t.Fatalf("GetPriceAlerts() error: %v", err)
	}
	if len(alerts) != 1 {
		t.Fatalf("expected 1 alert, got %d", len(alerts))
	}

	// Remove alert
	err = svc.RemovePriceAlert(ctx, userID, alert.ID)
	if err != nil {
		t.Fatalf("RemovePriceAlert() error: %v", err)
	}

	// Verify removed
	alerts, err = svc.GetPriceAlerts(ctx, userID)
	if err != nil {
		t.Fatalf("GetPriceAlerts() after remove error: %v", err)
	}
	if len(alerts) != 0 {
		t.Fatalf("expected 0 alerts after remove, got %d", len(alerts))
	}
}

func TestBuy_DecimalPrecision_Exact(t *testing.T) {
	svc, userID := setupCryptoService(t)
	ctx := context.Background()

	// The classic float trap: 0.1 + 0.2 == 0.30000000000000004 in float64.
	// With decimal end-to-end the stored balance must be EXACTLY 0.3.
	for _, amt := range []float64{0.1, 0.2} {
		if _, err := svc.Buy(ctx, userID, &crypto.BuyRequest{
			Asset: "BTC", Amount: d(amt), Price: d(1), FromCurrency: "CRC", FromAmount: d(1000),
		}); err != nil {
			t.Fatalf("buy %v: %v", amt, err)
		}
	}

	assets, err := svc.GetAssets(ctx, userID)
	if err != nil {
		t.Fatalf("GetAssets() error: %v", err)
	}
	var btc *crypto.AssetRecord
	for i := range assets {
		if assets[i].Symbol == "BTC" {
			btc = &assets[i]
			break
		}
	}
	if btc == nil {
		t.Fatal("BTC asset not found")
	}
	want := decimal.RequireFromString("0.3")
	if !btc.Balance.Equal(want) {
		t.Fatalf("balance = %s, want exactly 0.3 (float drift?)", btc.Balance.String())
	}
}

func TestGetTransactions_AfterBuySell(t *testing.T) {
	svc, userID := setupCryptoService(t)
	ctx := context.Background()

	// Buy
	_, _ = svc.Buy(ctx, userID, &crypto.BuyRequest{
		Asset: "BTC", Amount: d(0.1), Price: d(50000000), FromCurrency: "CRC", FromAmount: d(5000000),
	})
	// Sell
	_, _ = svc.Sell(ctx, userID, &crypto.SellRequest{
		Asset: "BTC", Amount: d(0.05), Price: d(50000000), ToCurrency: "CRC", ToAmount: d(2500000),
	})

	txs, err := svc.GetTransactions(ctx, userID)
	if err != nil {
		t.Fatalf("GetTransactions() error: %v", err)
	}
	if len(txs) < 2 {
		t.Fatalf("expected at least 2 crypto transactions, got %d", len(txs))
	}
}
