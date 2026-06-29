package marketplace_test

import (
	"context"
	"log/slog"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
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
	// The trip clock starts at confirmation, so the live status is 'arriving'
	// (the persisted status is 'confirmed').
	if confirmed.Status != "arriving" {
		t.Fatalf("status = %s, want arriving", confirmed.Status)
	}
	var persisted string
	if err := pool.QueryRow(ctx, `SELECT status FROM ride_requests WHERE id = $1::uuid`, ride.ID).Scan(&persisted); err != nil {
		t.Fatalf("read persisted status: %v", err)
	}
	if persisted != "confirmed" {
		t.Fatalf("persisted status = %s, want confirmed", persisted)
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

// Even if a confirmed ride is forced back to 'searching' at the DB level, a
// second confirm must not produce a second wallet debit (stable ledger key).
func TestConfirmRide_NoDoubleChargeOnReset(t *testing.T) {
	svc, pool, user := setupMarketplace(t)
	ctx := context.Background()

	ride, err := svc.CreateRideRequest(ctx, user, &marketplace.CreateRideRequest{
		PartnerCode: "uber", Pickup: "A", Destination: "B",
	})
	if err != nil {
		t.Fatalf("CreateRideRequest: %v", err)
	}
	w0 := walletCRC(t, pool, user)

	if _, err := svc.ConfirmRide(ctx, user, ride.ID); err != nil {
		t.Fatalf("ConfirmRide: %v", err)
	}
	afterFirst := walletCRC(t, pool, user)
	if afterFirst != w0-ride.EstimatedPrice {
		t.Fatalf("first charge wrong: %d, want %d", afterFirst, w0-ride.EstimatedPrice)
	}

	// Force the row back to searching (simulating a malicious/buggy status reset).
	if _, err := pool.Exec(ctx,
		`UPDATE ride_requests SET status = 'searching' WHERE id = $1::uuid`, ride.ID); err != nil {
		t.Fatalf("force searching: %v", err)
	}

	// A second confirm runs the charge again, but the stable idempotency key
	// collapses it to a no-op: the wallet is unchanged.
	if _, err := svc.ConfirmRide(ctx, user, ride.ID); err != nil {
		t.Fatalf("second ConfirmRide: %v", err)
	}
	if got := walletCRC(t, pool, user); got != afterFirst {
		t.Fatalf("second confirm double-charged: %d, want %d", got, afterFirst)
	}
}

// A food order progresses preparing -> delivered purely from elapsed time, the
// delivered state is persisted (backfill), the backfill is idempotent, and no
// read ever moves money.
func TestGetFoodOrder_LiveStatusAndBackfill(t *testing.T) {
	svc, pool, user := setupMarketplace(t)
	ctx := context.Background()

	order, err := svc.CreateFoodOrder(ctx, user, &marketplace.CreateFoodOrderRequest{
		PartnerCode:    "ubereats",
		RestaurantName: "Soda Tica",
		Items:          []marketplace.FoodOrderItemReq{{Name: "Casado", Quantity: 1, Price: 300000}},
	})
	if err != nil {
		t.Fatalf("CreateFoodOrder: %v", err)
	}
	wAfterOrder := walletCRC(t, pool, user)

	// A fresh order is still preparing.
	got, _, err := svc.GetFoodOrder(ctx, order.ID, user)
	if err != nil {
		t.Fatalf("GetFoodOrder: %v", err)
	}
	if got.Status != "preparing" {
		t.Fatalf("fresh order status = %s, want preparing", got.Status)
	}

	// A non-owner read returns not-found and must NOT trigger the backfill write.
	if _, _, err := svc.GetFoodOrder(ctx, order.ID, uuid.NewString()); err == nil {
		t.Fatal("expected not-found reading another user's order")
	}

	// Backdate creation well past any ETA -> derives + persists delivered.
	if _, err := pool.Exec(ctx,
		`UPDATE food_orders SET created_at = NOW() - INTERVAL '3 hours' WHERE id = $1::uuid`, order.ID); err != nil {
		t.Fatalf("backdate: %v", err)
	}

	got, _, err = svc.GetFoodOrder(ctx, order.ID, user)
	if err != nil {
		t.Fatalf("GetFoodOrder (aged): %v", err)
	}
	if got.Status != "delivered" {
		t.Fatalf("aged order status = %s, want delivered", got.Status)
	}
	if got.CompletedAt == nil {
		t.Fatal("delivered order should expose completed_at")
	}

	// The terminal state is persisted on the row.
	var stored string
	var completed *time.Time
	if err := pool.QueryRow(ctx,
		`SELECT status, completed_at FROM food_orders WHERE id = $1::uuid`, order.ID).Scan(&stored, &completed); err != nil {
		t.Fatalf("read row: %v", err)
	}
	if stored != "delivered" || completed == nil {
		t.Fatalf("backfill not persisted: status=%s completed=%v", stored, completed)
	}
	firstCompleted := *completed

	// Idempotent: a second read does not move completed_at.
	if _, _, err := svc.GetFoodOrder(ctx, order.ID, user); err != nil {
		t.Fatalf("GetFoodOrder (idempotent): %v", err)
	}
	if err := pool.QueryRow(ctx,
		`SELECT completed_at FROM food_orders WHERE id = $1::uuid`, order.ID).Scan(&completed); err != nil {
		t.Fatalf("read row 2: %v", err)
	}
	if !completed.Equal(firstCompleted) {
		t.Fatalf("completed_at changed on second read: %v vs %v", firstCompleted, *completed)
	}

	// Reads never moved money.
	if w := walletCRC(t, pool, user); w != wAfterOrder {
		t.Fatalf("wallet changed across reads: %d vs %d", w, wAfterOrder)
	}
}

// A confirmed ride progresses arriving -> completed purely from elapsed time,
// completed is persisted (backfill), the backfill is idempotent, and no read
// moves money.
func TestGetRideRequest_LiveProgressAndBackfill(t *testing.T) {
	svc, pool, user := setupMarketplace(t)
	ctx := context.Background()

	ride, err := svc.CreateRideRequest(ctx, user, &marketplace.CreateRideRequest{
		PartnerCode: "uber", Pickup: "A", Destination: "B",
	})
	if err != nil {
		t.Fatalf("CreateRideRequest: %v", err)
	}

	// An unconfirmed (searching) ride is not progressed by a read.
	got, err := svc.GetRideRequest(ctx, ride.ID, user)
	if err != nil {
		t.Fatalf("GetRideRequest: %v", err)
	}
	if got.Status != "searching" {
		t.Fatalf("fresh ride status = %s, want searching", got.Status)
	}

	if _, err := svc.ConfirmRide(ctx, user, ride.ID); err != nil {
		t.Fatalf("ConfirmRide: %v", err)
	}
	wAfterConfirm := walletCRC(t, pool, user)

	// A non-owner read returns not-found and must NOT trigger the backfill write.
	if _, err := svc.GetRideRequest(ctx, ride.ID, uuid.NewString()); err == nil {
		t.Fatal("expected not-found reading another user's ride")
	}

	// Backdate creation well past the ETA -> derives + persists completed.
	if _, err := pool.Exec(ctx,
		`UPDATE ride_requests SET created_at = NOW() - INTERVAL '3 hours' WHERE id = $1::uuid`, ride.ID); err != nil {
		t.Fatalf("backdate: %v", err)
	}

	got, err = svc.GetRideRequest(ctx, ride.ID, user)
	if err != nil {
		t.Fatalf("GetRideRequest (aged): %v", err)
	}
	if got.Status != "completed" {
		t.Fatalf("aged ride status = %s, want completed", got.Status)
	}
	if got.CompletedAt == nil {
		t.Fatal("completed ride should expose completed_at")
	}

	// The terminal state is persisted on the row.
	var stored string
	var completed *time.Time
	if err := pool.QueryRow(ctx,
		`SELECT status, completed_at FROM ride_requests WHERE id = $1::uuid`, ride.ID).Scan(&stored, &completed); err != nil {
		t.Fatalf("read row: %v", err)
	}
	if stored != "completed" || completed == nil {
		t.Fatalf("backfill not persisted: status=%s completed=%v", stored, completed)
	}
	firstCompleted := *completed

	// Idempotent: a second read does not move completed_at.
	if _, err := svc.GetRideRequest(ctx, ride.ID, user); err != nil {
		t.Fatalf("GetRideRequest (idempotent): %v", err)
	}
	if err := pool.QueryRow(ctx,
		`SELECT completed_at FROM ride_requests WHERE id = $1::uuid`, ride.ID).Scan(&completed); err != nil {
		t.Fatalf("read row 2: %v", err)
	}
	if !completed.Equal(firstCompleted) {
		t.Fatalf("completed_at changed on second read: %v vs %v", firstCompleted, *completed)
	}

	// The only charge was at confirmation; reads moved no money.
	if w := walletCRC(t, pool, user); w != wAfterConfirm {
		t.Fatalf("wallet changed across reads: %d vs %d", w, wAfterConfirm)
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
