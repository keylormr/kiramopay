package marketplace

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Repository struct {
	db *pgxpool.Pool
}

func NewRepository(db *pgxpool.Pool) *Repository {
	return &Repository{db: db}
}

// ── Partners ─────────────────────────────────────────────────────────────────

func (r *Repository) GetPartners(ctx context.Context) ([]PartnerRecord, error) {
	rows, err := r.db.Query(ctx,
		`SELECT id, code, name, category, logo, color, description, active, created_at
		 FROM marketplace_partners WHERE active = TRUE ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var partners []PartnerRecord
	for rows.Next() {
		var p PartnerRecord
		if err := rows.Scan(&p.ID, &p.Code, &p.Name, &p.Category, &p.Logo, &p.Color, &p.Description, &p.Active, &p.CreatedAt); err != nil {
			return nil, err
		}
		partners = append(partners, p)
	}
	return partners, nil
}

func (r *Repository) GetConnectedPartners(ctx context.Context, userID string) ([]string, error) {
	rows, err := r.db.Query(ctx,
		`SELECT partner_code FROM user_partner_connections WHERE user_id = $1`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var codes []string
	for rows.Next() {
		var code string
		if err := rows.Scan(&code); err != nil {
			return nil, err
		}
		codes = append(codes, code)
	}
	return codes, nil
}

func (r *Repository) ConnectPartner(ctx context.Context, userID, partnerCode string) error {
	_, err := r.db.Exec(ctx,
		`INSERT INTO user_partner_connections (user_id, partner_code)
		 VALUES ($1, $2) ON CONFLICT (user_id, partner_code) DO NOTHING`,
		userID, partnerCode)
	return err
}

func (r *Repository) DisconnectPartner(ctx context.Context, userID, partnerCode string) error {
	_, err := r.db.Exec(ctx,
		`DELETE FROM user_partner_connections WHERE user_id = $1 AND partner_code = $2`,
		userID, partnerCode)
	return err
}

// WalletBalance returns the user's spendable balance in the given currency.
func (r *Repository) WalletBalance(ctx context.Context, userID, currency string) (int64, error) {
	q := `SELECT balance_crc FROM wallets WHERE user_id = $1::uuid`
	if currency == "USD" {
		q = `SELECT balance_usd FROM wallets WHERE user_id = $1::uuid`
	}
	var bal int64
	if err := r.db.QueryRow(ctx, q, userID).Scan(&bal); err != nil {
		return 0, err
	}
	return bal, nil
}

// ── Ride Requests ────────────────────────────────────────────────────────────

func (r *Repository) CreateRideRequest(ctx context.Context, ride *RideRequestRecord) error {
	_, err := r.db.Exec(ctx,
		`INSERT INTO ride_requests (id, user_id, partner_code, pickup, destination,
		 estimated_price, estimated_time, distance, status,
		 driver_name, driver_rating, driver_car, driver_plate)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
		ride.ID, ride.UserID, ride.PartnerCode, ride.Pickup, ride.Destination,
		ride.EstimatedPrice, ride.EstimatedTime, ride.Distance, ride.Status,
		ride.DriverName, ride.DriverRating, ride.DriverCar, ride.DriverPlate)
	return err
}

func (r *Repository) GetRideRequest(ctx context.Context, rideID, userID string) (*RideRequestRecord, error) {
	var ride RideRequestRecord
	// Scoped by user_id so a non-owner gets no rows (the caller 404s) and the
	// derive/backfill side effect never runs on someone else's ride.
	// elapsed_seconds is computed by the DB (timezone-safe).
	err := r.db.QueryRow(ctx,
		`SELECT id, user_id, partner_code, pickup, destination,
		 estimated_price, estimated_time, distance, status,
		 COALESCE(driver_name, ''), COALESCE(driver_rating, 0), COALESCE(driver_car, ''),
		 COALESCE(driver_plate, ''), COALESCE(final_price, 0),
		 created_at, completed_at,
		 GREATEST(0, EXTRACT(EPOCH FROM (NOW() - created_at)))::bigint
		 FROM ride_requests WHERE id = $1 AND user_id = $2`, rideID, userID).Scan(
		&ride.ID, &ride.UserID, &ride.PartnerCode, &ride.Pickup, &ride.Destination,
		&ride.EstimatedPrice, &ride.EstimatedTime, &ride.Distance, &ride.Status,
		&ride.DriverName, &ride.DriverRating, &ride.DriverCar, &ride.DriverPlate,
		&ride.FinalPrice, &ride.CreatedAt, &ride.CompletedAt,
		&ride.ElapsedSeconds)
	if err != nil {
		return nil, err
	}
	return &ride, nil
}

func (r *Repository) UpdateRideStatus(ctx context.Context, rideID, status string) error {
	query := `UPDATE ride_requests SET status = $2 WHERE id = $1`
	if status == "completed" || status == "cancelled" {
		query = `UPDATE ride_requests SET status = $2, completed_at = NOW() WHERE id = $1`
	}
	result, err := r.db.Exec(ctx, query, rideID, status)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return fmt.Errorf("ride request not found")
	}
	return nil
}

// ConfirmRideRow flips a ride from searching to confirmed and re-anchors
// created_at to the confirmation instant, so the trip clock starts at
// confirmation (not request time). The status='searching' guard makes the
// transition atomic: under a concurrent double-confirm exactly one call flips
// the row; the loser gets 0 rows and an error.
func (r *Repository) ConfirmRideRow(ctx context.Context, rideID string) error {
	res, err := r.db.Exec(ctx,
		`UPDATE ride_requests SET status = 'confirmed', created_at = NOW()
		 WHERE id = $1 AND status = 'searching'`, rideID)
	if err != nil {
		return err
	}
	if res.RowsAffected() == 0 {
		return fmt.Errorf("ride is not in a confirmable state")
	}
	return nil
}

// MarkRideCompletedIfDue persists the completed terminal state for a ride whose
// ETA has elapsed. completed_at is the true arrival instant (created_at + ETA),
// never NOW(), so the write is idempotent. The status guard makes concurrent
// reads race-safe. 0 rows affected is not an error.
func (r *Repository) MarkRideCompletedIfDue(ctx context.Context, rideID string, etaMinutes int) error {
	_, err := r.db.Exec(ctx,
		`UPDATE ride_requests
		 SET status = 'completed', completed_at = created_at + make_interval(mins => $2)
		 WHERE id = $1 AND status NOT IN ('completed', 'cancelled', 'searching')`,
		rideID, etaMinutes)
	return err
}

func (r *Repository) ListUserRides(ctx context.Context, userID string, limit int) ([]RideRequestRecord, error) {
	rows, err := r.db.Query(ctx,
		`SELECT id, user_id, partner_code, pickup, destination,
		 estimated_price, estimated_time, distance, status,
		 COALESCE(driver_name, ''), COALESCE(driver_rating, 0), COALESCE(driver_car, ''),
		 COALESCE(driver_plate, ''), COALESCE(final_price, 0),
		 created_at, completed_at,
		 GREATEST(0, EXTRACT(EPOCH FROM (NOW() - created_at)))::bigint
		 FROM ride_requests WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
		userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var rides []RideRequestRecord
	for rows.Next() {
		var ride RideRequestRecord
		if err := rows.Scan(
			&ride.ID, &ride.UserID, &ride.PartnerCode, &ride.Pickup, &ride.Destination,
			&ride.EstimatedPrice, &ride.EstimatedTime, &ride.Distance, &ride.Status,
			&ride.DriverName, &ride.DriverRating, &ride.DriverCar, &ride.DriverPlate,
			&ride.FinalPrice, &ride.CreatedAt, &ride.CompletedAt,
			&ride.ElapsedSeconds); err != nil {
			return nil, err
		}
		rides = append(rides, ride)
	}
	return rides, nil
}

// ── Food Orders ──────────────────────────────────────────────────────────────

func (r *Repository) CreateFoodOrder(ctx context.Context, order *FoodOrderRecord, items []FoodOrderItemRecord) error {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	_, err = tx.Exec(ctx,
		`INSERT INTO food_orders (id, user_id, partner_code, restaurant_name,
		 subtotal, delivery_fee, total, status, estimated_delivery)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
		order.ID, order.UserID, order.PartnerCode, order.RestaurantName,
		order.Subtotal, order.DeliveryFee, order.Total, order.Status, order.EstimatedDelivery)
	if err != nil {
		return err
	}

	for _, item := range items {
		_, err = tx.Exec(ctx,
			`INSERT INTO food_order_items (id, order_id, name, quantity, price)
			 VALUES ($1, $2, $3, $4, $5)`,
			item.ID, order.ID, item.Name, item.Quantity, item.Price)
		if err != nil {
			return err
		}
	}

	return tx.Commit(ctx)
}

func (r *Repository) GetFoodOrder(ctx context.Context, orderID, userID string) (*FoodOrderRecord, []FoodOrderItemRecord, error) {
	var order FoodOrderRecord
	// Scoped by user_id so a non-owner gets no rows (the caller 404s) and the
	// derive/backfill side effect never runs on someone else's order.
	// elapsed_seconds is computed by the DB (NOW() - created_at), which is
	// timezone-safe regardless of the session TZ or the column type.
	err := r.db.QueryRow(ctx,
		`SELECT id, user_id, partner_code, restaurant_name,
		 subtotal, delivery_fee, total, status, estimated_delivery,
		 created_at, completed_at,
		 GREATEST(0, EXTRACT(EPOCH FROM (NOW() - created_at)))::bigint
		 FROM food_orders WHERE id = $1 AND user_id = $2`, orderID, userID).Scan(
		&order.ID, &order.UserID, &order.PartnerCode, &order.RestaurantName,
		&order.Subtotal, &order.DeliveryFee, &order.Total, &order.Status,
		&order.EstimatedDelivery, &order.CreatedAt, &order.CompletedAt,
		&order.ElapsedSeconds)
	if err != nil {
		return nil, nil, err
	}

	rows, err := r.db.Query(ctx,
		`SELECT id, order_id, name, quantity, price FROM food_order_items WHERE order_id = $1`,
		orderID)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()

	var items []FoodOrderItemRecord
	for rows.Next() {
		var item FoodOrderItemRecord
		if err := rows.Scan(&item.ID, &item.OrderID, &item.Name, &item.Quantity, &item.Price); err != nil {
			return nil, nil, err
		}
		items = append(items, item)
	}

	return &order, items, nil
}

func (r *Repository) UpdateFoodOrderStatus(ctx context.Context, orderID, status string) error {
	query := `UPDATE food_orders SET status = $2 WHERE id = $1`
	if status == "delivered" || status == "cancelled" {
		query = `UPDATE food_orders SET status = $2, completed_at = NOW() WHERE id = $1`
	}
	result, err := r.db.Exec(ctx, query, orderID, status)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return fmt.Errorf("food order not found")
	}
	return nil
}

// MarkFoodOrderDeliveredIfDue persists the delivered terminal state for an order
// whose ETA has elapsed. completed_at is the true delivery instant
// (created_at + ETA), never NOW(), so the write is idempotent and correct even
// if the order is opened late. The status guard makes concurrent reads race-safe
// (first writer wins; the rest are no-ops). 0 rows affected is not an error.
func (r *Repository) MarkFoodOrderDeliveredIfDue(ctx context.Context, orderID string, etaMinutes int) error {
	_, err := r.db.Exec(ctx,
		`UPDATE food_orders
		 SET status = 'delivered', completed_at = created_at + make_interval(mins => $2)
		 WHERE id = $1 AND status NOT IN ('delivered', 'cancelled')`,
		orderID, etaMinutes)
	return err
}

func (r *Repository) ListUserFoodOrders(ctx context.Context, userID string, limit int) ([]FoodOrderRecord, error) {
	rows, err := r.db.Query(ctx,
		`SELECT id, user_id, partner_code, restaurant_name,
		 subtotal, delivery_fee, total, status, estimated_delivery,
		 created_at, completed_at,
		 GREATEST(0, EXTRACT(EPOCH FROM (NOW() - created_at)))::bigint
		 FROM food_orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
		userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var orders []FoodOrderRecord
	for rows.Next() {
		var order FoodOrderRecord
		if err := rows.Scan(
			&order.ID, &order.UserID, &order.PartnerCode, &order.RestaurantName,
			&order.Subtotal, &order.DeliveryFee, &order.Total, &order.Status,
			&order.EstimatedDelivery, &order.CreatedAt, &order.CompletedAt,
			&order.ElapsedSeconds); err != nil {
			return nil, err
		}
		orders = append(orders, order)
	}
	return orders, nil
}

// ── Seeding ──────────────────────────────────────────────────────────────────

func (r *Repository) SeedPartners(ctx context.Context) error {
	partners := []struct {
		Code, Name, Category, Logo, Color, Description string
	}{
		{"uber", "Uber", "transport", "uber", "#000000", "Solicita viajes de forma rápida y segura"},
		{"didi", "DiDi", "transport", "didi", "#FF6600", "Viajes económicos en Costa Rica"},
		{"indriver", "InDriver", "transport", "indriver", "#2FCC46", "Negocia tu precio de viaje"},
		{"ubereats", "Uber Eats", "food", "ubereats", "#06C167", "Comida a domicilio de tus restaurantes favoritos"},
		{"pedidosya", "PedidosYa", "food", "pedidosya", "#FA0050", "Delivery de comida y supermercado"},
		{"rappi", "Rappi", "food", "rappi", "#FF441F", "Todo lo que necesitas a domicilio"},
		{"automercado", "Auto Mercado", "supermarket", "automercado", "#E31E24", "Supermercado premium de Costa Rica"},
		{"walmart", "Walmart", "supermarket", "walmart", "#0071DC", "Precios bajos siempre"},
		{"masxmenos", "Mas x Menos", "supermarket", "masxmenos", "#E4002B", "Tu supermercado de confianza"},
		{"pricesmart", "PriceSmart", "supermarket", "pricesmart", "#003DA5", "Compras al por mayor"},
		{"cinemark", "Cinemark", "entertainment", "cinemark", "#003DA5", "Las mejores películas en cartelera"},
		{"novacinemas", "Nova Cinemas", "entertainment", "novacinemas", "#8B0000", "Tu experiencia de cine premium"},
	}

	for _, p := range partners {
		_, err := r.db.Exec(ctx,
			`INSERT INTO marketplace_partners (code, name, category, logo, color, description)
			 VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (code) DO NOTHING`,
			p.Code, p.Name, p.Category, p.Logo, p.Color, p.Description)
		if err != nil {
			return err
		}
	}
	return nil
}

func (r *Repository) SeedUserConnections(ctx context.Context, userID string) error {
	defaults := []string{"uber", "ubereats"}
	now := time.Now()
	for _, code := range defaults {
		_, err := r.db.Exec(ctx,
			`INSERT INTO user_partner_connections (user_id, partner_code, connected_at)
			 VALUES ($1, $2, $3) ON CONFLICT (user_id, partner_code) DO NOTHING`,
			userID, code, now)
		if err != nil {
			return err
		}
	}
	return nil
}
