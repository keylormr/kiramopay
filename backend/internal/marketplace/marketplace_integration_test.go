package marketplace_test

import (
	"context"
	"log/slog"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/kiramopay/backend/internal/ledger"
	"github.com/kiramopay/backend/internal/marketplace"
	"github.com/kiramopay/backend/internal/testutil"
	"github.com/kiramopay/backend/internal/transaction"
	"github.com/kiramopay/backend/internal/wallet"
	"github.com/kiramopay/backend/pkg/hash"
)

func setupMarketplace(t *testing.T) (*marketplace.Service, *pgxpool.Pool, string) {
	t.Helper()
	pool := testutil.TestDB(t)
	l := ledger.NewEngine(pool, slog.New(slog.NewJSONHandler(os.Stdout, nil)))
	txSvc := transaction.NewService(transaction.NewRepository(pool), wallet.NewRepository(pool), l, nil)
	svc := marketplace.NewService(marketplace.NewRepository(pool), l, txSvc)
	pinHash, _ := hash.HashPin("Kiramopay2024!")
	user := testutil.SeedTestUser(t, pool, "702650930", pinHash)
	return svc, pool, user
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

// Placing a food order debits the wallet for the total (subtotal + delivery).
func TestCreateFoodOrder_DebitsWallet(t *testing.T) {
	svc, pool, user := setupMarketplace(t)
	ctx := context.Background()
	w0 := walletCRC(t, pool, user)

	order, err := svc.CreateFoodOrder(ctx, user, &marketplace.CreateFoodOrderRequest{
		PartnerCode:    "ubereats",
		RestaurantName: "Soda Tica",
		Items:          []marketplace.FoodOrderItemReq{{Name: "Casado", Quantity: 2, Price: 350000}},
	})
	if err != nil {
		t.Fatalf("CreateFoodOrder: %v", err)
	}
	// subtotal 2*350000 = 700000 + delivery 150000 = 850000
	if order.Total != 850000 {
		t.Fatalf("total = %d, want 850000", order.Total)
	}
	if got := walletCRC(t, pool, user); got != w0-850000 {
		t.Fatalf("wallet = %d, want %d", got, w0-850000)
	}
}

// Confirming a ride charges the estimated price once; a second confirm is rejected.
func TestConfirmRide_DebitsWallet(t *testing.T) {
	svc, pool, user := setupMarketplace(t)
	ctx := context.Background()

	ride, err := svc.CreateRideRequest(ctx, user, &marketplace.CreateRideRequest{
		PartnerCode: "uber", Pickup: "A", Destination: "B",
	})
	if err != nil {
		t.Fatalf("CreateRideRequest: %v", err)
	}
	// A driver is matched and persisted at request time, before any charge.
	if ride.DriverName == "" || ride.DriverPlate == "" {
		t.Fatalf("expected a driver assigned at creation, got %+v", ride)
	}
	w0 := walletCRC(t, pool, user) // no debit yet at request time

	confirmed, err := svc.ConfirmRide(ctx, user, ride.ID)
	if err != nil {
		t.Fatalf("ConfirmRide: %v", err)
	}
	if confirmed.Status != "confirmed" {
		t.Fatalf("status = %s, want confirmed", confirmed.Status)
	}
	// The driver assigned at creation survives the DB round-trip on confirm.
	if confirmed.DriverName != ride.DriverName {
		t.Fatalf("driver = %q, want %q", confirmed.DriverName, ride.DriverName)
	}
	if got := walletCRC(t, pool, user); got != w0-ride.EstimatedPrice {
		t.Fatalf("wallet = %d, want %d", got, w0-ride.EstimatedPrice)
	}
	if _, err := svc.ConfirmRide(ctx, user, ride.ID); err == nil {
		t.Fatal("expected error confirming an already-confirmed ride")
	}
}

func TestCreateFoodOrder_InsufficientBalance(t *testing.T) {
	svc, pool, user := setupMarketplace(t)
	ctx := context.Background()
	tooMuch := walletCRC(t, pool, user) + 1
	if _, err := svc.CreateFoodOrder(ctx, user, &marketplace.CreateFoodOrderRequest{
		PartnerCode: "ubereats", RestaurantName: "Soda",
		Items: []marketplace.FoodOrderItemReq{{Name: "Caro", Quantity: 1, Price: tooMuch}},
	}); err == nil {
		t.Fatal("expected insufficient-balance error")
	}
}
