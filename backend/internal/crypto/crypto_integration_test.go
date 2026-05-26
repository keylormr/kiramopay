package crypto_test

import (
	"context"
	"testing"

	"github.com/kiramopay/backend/internal/crypto"
	"github.com/kiramopay/backend/internal/testutil"
	"github.com/kiramopay/backend/pkg/hash"
)

func setupCryptoService(t *testing.T) (*crypto.Service, string) {
	t.Helper()
	pool := testutil.TestDB(t)

	repo := crypto.NewRepository(pool)
	priceService := crypto.NewPriceService()
	svc := crypto.NewService(repo, priceService)

	pinHash, _ := hash.HashPin("1234")
	userID := testutil.SeedTestUser(t, pool, "702650930", pinHash)

	return svc, userID
}

func TestGetPrices(t *testing.T) {
	svc, _ := setupCryptoService(t)

	prices, err := svc.GetPrices([]string{"BTC", "ETH", "SOL"})
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
		Amount:       0.001,
		Price:        50000000,
		FromCurrency: "CRC",
		FromAmount:   50000,
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
		Amount:       1.0,
		Price:        3000000,
		FromCurrency: "CRC",
		FromAmount:   3000000,
	})
	if err != nil {
		t.Fatalf("Buy() error: %v", err)
	}

	// Sell
	tx, err := svc.Sell(ctx, userID, &crypto.SellRequest{
		Asset:      "ETH",
		Amount:     0.5,
		Price:      3000000,
		ToCurrency: "CRC",
		ToAmount:   1500000,
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
		Amount:       0.5,
		Price:        50000000,
		FromCurrency: "CRC",
		FromAmount:   25000000,
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

	staking, err := svc.Stake(ctx, userID, &crypto.StakeRequest{
		Asset:    "ETH",
		Amount:   2.0,
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

	staking, err := svc.Stake(ctx, userID, &crypto.StakeRequest{
		Asset:  "SOL",
		Amount: 10.0,
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
		TargetPrice: 100000,
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
	err = svc.RemovePriceAlert(ctx, alert.ID)
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

func TestGetTransactions_AfterBuySell(t *testing.T) {
	svc, userID := setupCryptoService(t)
	ctx := context.Background()

	// Buy
	_, _ = svc.Buy(ctx, userID, &crypto.BuyRequest{
		Asset: "BTC", Amount: 0.1, Price: 50000000, FromCurrency: "CRC", FromAmount: 5000000,
	})
	// Sell
	_, _ = svc.Sell(ctx, userID, &crypto.SellRequest{
		Asset: "BTC", Amount: 0.05, Price: 50000000, ToCurrency: "CRC", ToAmount: 2500000,
	})

	txs, err := svc.GetTransactions(ctx, userID)
	if err != nil {
		t.Fatalf("GetTransactions() error: %v", err)
	}
	if len(txs) < 2 {
		t.Fatalf("expected at least 2 crypto transactions, got %d", len(txs))
	}
}
