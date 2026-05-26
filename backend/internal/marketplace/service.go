package marketplace

import (
	"context"
	"fmt"
	"math/rand"
	"time"

	"github.com/google/uuid"
)

type Service struct {
	repo *Repository
}

func NewService(repo *Repository) *Service {
	return &Service{repo: repo}
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

func (s *Service) CreateRideRequest(ctx context.Context, userID string, req *CreateRideRequest) (*RideRequestRecord, error) {
	if req.Pickup == "" || req.Destination == "" {
		return nil, fmt.Errorf("pickup and destination are required")
	}

	// Simulate estimated price (2500-15000 CRC) and time
	estimatedPrice := int64(2500+rand.Intn(12500)) * 100 // in centimos
	estimatedMins := 8 + rand.Intn(25)
	distance := fmt.Sprintf("%.1f km", 1.5+rand.Float64()*15.0)

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
