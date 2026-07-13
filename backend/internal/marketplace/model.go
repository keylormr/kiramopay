package marketplace

import "time"

// ── Partner ──────────────────────────────────────────────────────────────────

type PartnerRecord struct {
	ID          string    `json:"id"`
	Code        string    `json:"code"`
	Name        string    `json:"name"`
	Category    string    `json:"category"` // transport, food, supermarket, entertainment, shopping
	Logo        string    `json:"logo"`
	Color       string    `json:"color"`
	Description string    `json:"description"`
	Active      bool      `json:"active"`
	CreatedAt   time.Time `json:"created_at"`
}

type UserPartnerConnection struct {
	ID          string    `json:"id"`
	UserID      string    `json:"user_id"`
	PartnerCode string    `json:"partner_code"`
	ConnectedAt time.Time `json:"connected_at"`
}

// ── Ride Request ─────────────────────────────────────────────────────────────

type RideRequestRecord struct {
	ID             string     `json:"id"`
	UserID         string     `json:"user_id"`
	PartnerCode    string     `json:"partner_code"`
	Pickup         string     `json:"pickup"`
	Destination    string     `json:"destination"`
	EstimatedPrice int64      `json:"estimated_price"` // centimos
	EstimatedTime  string     `json:"estimated_time"`
	Distance       string     `json:"distance"`
	Status         string     `json:"status"` // searching, confirmed, arriving, in_progress, completed, cancelled
	DriverName     string     `json:"driver_name,omitempty"`
	DriverRating   float64    `json:"driver_rating,omitempty"`
	DriverCar      string     `json:"driver_car,omitempty"`
	DriverPlate    string     `json:"driver_plate,omitempty"`
	FinalPrice     int64      `json:"final_price,omitempty"` // centimos
	CreatedAt      time.Time  `json:"created_at"`
	CompletedAt    *time.Time `json:"completed_at,omitempty"`

	// Computed at read time (never persisted): live trip progress after a ride is
	// confirmed. Status is derived from ElapsedSeconds (DB-computed) and the ETA.
	ElapsedSeconds   int64 `json:"-"`
	MinutesRemaining int   `json:"minutes_remaining"`
}

// ── Food Order ───────────────────────────────────────────────────────────────

type FoodOrderRecord struct {
	ID                string     `json:"id"`
	UserID            string     `json:"user_id"`
	PartnerCode       string     `json:"partner_code"`
	RestaurantName    string     `json:"restaurant_name"`
	Subtotal          int64      `json:"subtotal"`     // centimos
	DeliveryFee       int64      `json:"delivery_fee"` // centimos
	Total             int64      `json:"total"`        // centimos
	Status            string     `json:"status"`       // preparing, ready, on_the_way, delivered, cancelled
	EstimatedDelivery string     `json:"estimated_delivery"`
	CreatedAt         time.Time  `json:"created_at"`
	CompletedAt       *time.Time `json:"completed_at,omitempty"`

	// Computed at read time (never persisted): live delivery progress. Status is
	// derived from ElapsedSeconds (computed by the DB, timezone-safe) and the ETA.
	ElapsedSeconds   int64 `json:"-"`
	MinutesRemaining int   `json:"minutes_remaining"`
}

type FoodOrderItemRecord struct {
	ID       string `json:"id"`
	OrderID  string `json:"order_id"`
	Name     string `json:"name"`
	Quantity int    `json:"quantity"`
	Price    int64  `json:"price"` // centimos
}

// CourierInfo is the (simulated) delivery courier shown to the rider. Real
// courier assignment happens on the partner platform; until that integration
// exists we derive a stable courier from the order id so every read agrees.
type CourierInfo struct {
	Name    string `json:"name"`
	Vehicle string `json:"vehicle"`
	Plate   string `json:"plate"`
}

// FoodOrderResponse is the single-order GET payload: the order plus a computed
// courier (only present once the order is on the way / delivered).
type FoodOrderResponse struct {
	*FoodOrderRecord
	Courier *CourierInfo `json:"courier,omitempty"`
}

// ── Request / Response DTOs ──────────────────────────────────────────────────

type ConnectPartnerRequest struct {
	PartnerCode string `json:"partner_code"`
}

type CreateRideRequest struct {
	PartnerCode string `json:"partner_code"`
	Pickup      string `json:"pickup"`
	Destination string `json:"destination"`
}

type CreateFoodOrderRequest struct {
	PartnerCode    string             `json:"partner_code"`
	RestaurantName string             `json:"restaurant_name"`
	Items          []FoodOrderItemReq `json:"items"`
}

type FoodOrderItemReq struct {
	Name     string `json:"name"`
	Quantity int    `json:"quantity"`
	Price    int64  `json:"price"` // centimos
}
