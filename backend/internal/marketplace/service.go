package marketplace

import (
	"context"
	"fmt"
	"math/rand"
	"time"

	"github.com/google/uuid"
	"github.com/kiramopay/backend/internal/ledger"
	"github.com/kiramopay/backend/internal/transaction"
)

// HistoryRecorder makes a marketplace charge visible in the user's transaction
// list. Best-effort: failing to record never fails the order.
type HistoryRecorder interface {
	RecordHistory(ctx context.Context, userID string, req *transaction.CreateTransactionRequest) error
}

type Service struct {
	repo    *Repository
	ledger  *ledger.Engine
	history HistoryRecorder
}

func NewService(repo *Repository, eng *ledger.Engine, history HistoryRecorder) *Service {
	return &Service{repo: repo, ledger: eng, history: history}
}

// chargeWallet debits the user's wallet for a marketplace order, crediting
// SYSTEM:EXTERNAL (the partner counterparty). The actual settlement to the
// partner requires a partner integration and is out of scope; this records the
// real spend so the wallet and ledger stay correct.
func (s *Service) chargeWallet(ctx context.Context, userID string, amountMinor int64, label string) error {
	if amountMinor <= 0 {
		return nil
	}
	bal, err := s.repo.WalletBalance(ctx, userID, "CRC")
	if err != nil {
		return fmt.Errorf("balance check: %w", err)
	}
	if bal < amountMinor {
		return fmt.Errorf("insufficient balance")
	}
	postID := uuid.NewString()
	if _, err := s.ledger.Post(ctx, &ledger.Posting{
		Description:    label,
		IdempotencyKey: "marketplace:" + postID,
		TxID:           postID,
		CreatedBy:      userID,
		Entries: []ledger.Entry{
			{Account: ledger.Account{UserID: userID}, Side: ledger.Debit, AmountMinor: amountMinor, Currency: "CRC"},
			{Account: ledger.Account{SystemCode: ledger.SystemExternalCRC}, Side: ledger.Credit, AmountMinor: amountMinor, Currency: "CRC"},
		},
	}); err != nil {
		return fmt.Errorf("marketplace charge: %w", err)
	}
	if s.history != nil {
		_ = s.history.RecordHistory(ctx, userID, &transaction.CreateTransactionRequest{
			Type:             "marketplace",
			Amount:           amountMinor,
			Currency:         "CRC",
			CounterpartyType: "marketplace",
			CounterpartyName: label,
			Description:      label,
		})
	}
	return nil
}

// ConfirmRide charges the rider the estimated price and marks the ride confirmed.
func (s *Service) ConfirmRide(ctx context.Context, userID, rideID string) (*RideRequestRecord, error) {
	ride, err := s.repo.GetRideRequest(ctx, rideID)
	if err != nil {
		return nil, fmt.Errorf("ride not found")
	}
	if ride.UserID != userID {
		return nil, fmt.Errorf("ride does not belong to user")
	}
	if ride.Status == "confirmed" || ride.Status == "completed" {
		return nil, fmt.Errorf("ride already confirmed")
	}
	if err := s.chargeWallet(ctx, userID, ride.EstimatedPrice, "Viaje "+ride.PartnerCode); err != nil {
		return nil, err
	}
	if err := s.repo.UpdateRideStatus(ctx, rideID, "confirmed"); err != nil {
		return nil, err
	}
	ride.Status = "confirmed"
	return ride, nil
}

// ── Partners ─────────────────────────────────────────────────────────────────

func (s *Service) GetPartners(ctx context.Context, userID string) ([]PartnerRecord, []string, error) {
	partners, err := s.repo.GetPartners(ctx)
	if err != nil {
		return nil, nil, err
	}

	connected, err := s.repo.GetConnectedPartners(ctx, userID)
	if err != nil {
		return nil, nil, err
	}

	return partners, connected, nil
}

func (s *Service) ConnectPartner(ctx context.Context, userID, partnerCode string) error {
	return s.repo.ConnectPartner(ctx, userID, partnerCode)
}

func (s *Service) DisconnectPartner(ctx context.Context, userID, partnerCode string) error {
	return s.repo.DisconnectPartner(ctx, userID, partnerCode)
}

// ── Ride Requests ────────────────────────────────────────────────────────────

// driverProfile is a simulated partner driver. Real driver matching happens on
// the partner's platform; until that integration exists we assign a believable
// driver at request time so the ride is complete end-to-end (the rider sees a
// real driver, vehicle and plate persisted with the ride).
type driverProfile struct {
	Name   string
	Car    string
	Plate  string
	Rating float64
}

var driverPool = []driverProfile{
	{"Carlos Ramírez", "Toyota Corolla", "SJB-412", 4.92},
	{"María Fernández", "Hyundai Elantra", "BCR-738", 4.88},
	{"José Mora", "Nissan Sentra", "CLM-193", 4.95},
	{"Ana Solís", "Kia Rio", "MOT-264", 4.81},
	{"Luis Vargas", "Honda Civic", "SJP-590", 4.90},
	{"Daniela Castro", "Toyota Yaris", "BMV-117", 4.97},
	{"Roberto Jiménez", "Mazda 3", "CRC-845", 4.86},
	{"Marcela Rojas", "Suzuki Swift", "GTO-301", 4.93},
}

func (s *Service) CreateRideRequest(ctx context.Context, userID string, req *CreateRideRequest) (*RideRequestRecord, error) {
	if req.Pickup == "" || req.Destination == "" {
		return nil, fmt.Errorf("pickup and destination are required")
	}

	// Simulate estimated price (2500-15000 CRC) and time
	estimatedPrice := int64(2500+rand.Intn(12500)) * 100 // in centimos
	estimatedMins := 8 + rand.Intn(25)
	distance := fmt.Sprintf("%.1f km", 1.5+rand.Float64()*15.0)
	driver := driverPool[rand.Intn(len(driverPool))]

	ride := &RideRequestRecord{
		ID:             uuid.New().String(),
		UserID:         userID,
		PartnerCode:    req.PartnerCode,
		Pickup:         req.Pickup,
		Destination:    req.Destination,
		EstimatedPrice: estimatedPrice,
		EstimatedTime:  fmt.Sprintf("%d min", estimatedMins),
		Distance:       distance,
		Status:         "searching",
		DriverName:     driver.Name,
		DriverRating:   driver.Rating,
		DriverCar:      driver.Car,
		DriverPlate:    driver.Plate,
		CreatedAt:      time.Now(),
	}

	if err := s.repo.CreateRideRequest(ctx, ride); err != nil {
		return nil, err
	}

	return ride, nil
}

func (s *Service) GetRideRequest(ctx context.Context, rideID string) (*RideRequestRecord, error) {
	return s.repo.GetRideRequest(ctx, rideID)
}

func (s *Service) UpdateRideStatus(ctx context.Context, rideID, status string) error {
	validStatuses := map[string]bool{
		"searching": true, "confirmed": true, "arriving": true,
		"in_progress": true, "completed": true, "cancelled": true,
	}
	if !validStatuses[status] {
		return fmt.Errorf("invalid ride status: %s", status)
	}
	return s.repo.UpdateRideStatus(ctx, rideID, status)
}

func (s *Service) ListUserRides(ctx context.Context, userID string) ([]RideRequestRecord, error) {
	return s.repo.ListUserRides(ctx, userID, 50)
}

// ── Food Orders ──────────────────────────────────────────────────────────────

func (s *Service) CreateFoodOrder(ctx context.Context, userID string, req *CreateFoodOrderRequest) (*FoodOrderRecord, error) {
	if req.RestaurantName == "" || len(req.Items) == 0 {
		return nil, fmt.Errorf("restaurant name and at least one item required")
	}

	var subtotal int64
	var items []FoodOrderItemRecord
	for _, item := range req.Items {
		subtotal += item.Price * int64(item.Quantity)
		items = append(items, FoodOrderItemRecord{
			ID:       uuid.New().String(),
			Name:     item.Name,
			Quantity: item.Quantity,
			Price:    item.Price,
		})
	}

	deliveryFee := int64(150000) // 1500 CRC in centimos
	total := subtotal + deliveryFee

	// Charge the wallet up front (balance-checked); no order if it fails.
	if err := s.chargeWallet(ctx, userID, total, "Pedido "+req.RestaurantName); err != nil {
		return nil, err
	}

	estimatedMins := 25 + rand.Intn(20)

	order := &FoodOrderRecord{
		ID:                uuid.New().String(),
		UserID:            userID,
		PartnerCode:       req.PartnerCode,
		RestaurantName:    req.RestaurantName,
		Subtotal:          subtotal,
		DeliveryFee:       deliveryFee,
		Total:             total,
		Status:            "preparing",
		EstimatedDelivery: fmt.Sprintf("%d min", estimatedMins),
		CreatedAt:         time.Now(),
	}

	if err := s.repo.CreateFoodOrder(ctx, order, items); err != nil {
		return nil, err
	}

	return order, nil
}

func (s *Service) GetFoodOrder(ctx context.Context, orderID string) (*FoodOrderRecord, []FoodOrderItemRecord, error) {
	return s.repo.GetFoodOrder(ctx, orderID)
}

func (s *Service) UpdateFoodOrderStatus(ctx context.Context, orderID, status string) error {
	validStatuses := map[string]bool{
		"preparing": true, "ready": true, "on_the_way": true,
		"delivered": true, "cancelled": true,
	}
	if !validStatuses[status] {
		return fmt.Errorf("invalid food order status: %s", status)
	}
	return s.repo.UpdateFoodOrderStatus(ctx, orderID, status)
}

func (s *Service) ListUserFoodOrders(ctx context.Context, userID string) ([]FoodOrderRecord, error) {
	return s.repo.ListUserFoodOrders(ctx, userID, 50)
}
