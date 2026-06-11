package websocket

import (
	"context"
	"log/slog"
	"time"

	"github.com/kiramopay/backend/internal/crypto"
)

// PriceMessage is the message sent to WebSocket clients.
type PriceMessage struct {
	Type      string                       `json:"type"`
	Timestamp string                       `json:"timestamp"`
	Prices    map[string]*crypto.PriceData `json:"prices"`
}

// PriceBroadcaster periodically fetches prices and broadcasts them via WebSocket.
type PriceBroadcaster struct {
	hub          *Hub
	priceService *crypto.PriceService
	interval     time.Duration
	symbols      []string
	logger       *slog.Logger
	stop         chan struct{}
}

// NewPriceBroadcaster creates a new broadcaster.
func NewPriceBroadcaster(hub *Hub, priceService *crypto.PriceService, logger *slog.Logger) *PriceBroadcaster {
	return &PriceBroadcaster{
		hub:          hub,
		priceService: priceService,
		interval:     5 * time.Second,
		symbols:      []string{"BTC", "ETH", "SOL", "ADA", "DOT", "AVAX", "LINK", "MATIC", "UNI", "ATOM"},
		logger:       logger,
		stop:         make(chan struct{}),
	}
}

// Start begins the periodic price broadcasting.
func (pb *PriceBroadcaster) Start() {
	pb.logger.Info("Price broadcaster started", "interval", pb.interval)
	ticker := time.NewTicker(pb.interval)
	defer ticker.Stop()

	// Send initial prices immediately
	pb.broadcastPrices()

	for {
		select {
		case <-ticker.C:
			if pb.hub.ClientCount() > 0 {
				pb.broadcastPrices()
			}
		case <-pb.stop:
			pb.logger.Info("Price broadcaster stopped")
			return
		}
	}
}

// Stop halts the broadcaster.
func (pb *PriceBroadcaster) Stop() {
	close(pb.stop)
}

func (pb *PriceBroadcaster) broadcastPrices() {
	prices, err := pb.priceService.GetPrices(context.Background(), pb.symbols)
	if err != nil {
		pb.logger.Error("Failed to fetch prices for broadcast", "error", err)
		return
	}

	msg := PriceMessage{
		Type:      "price_update",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Prices:    prices,
	}

	pb.hub.Broadcast(msg)
}
