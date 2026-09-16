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
		// El ritmo lo dicta el plan de la clave (GetInterval), no un numero
		// clavado: con 5s fijos el tick consultaba el servicio cada 5s aunque
		// el tier Demo/keyless solo refresque su cache cada varios minutos —
		// puro ruido de log y cero datos nuevos.
		interval:     priceService.GetInterval(),
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
		Prices:    sinSparkline(prices),
	}

	pb.hub.Broadcast(msg)
}

// sinSparkline devuelve una copia liviana del mapa de precios sin el
// historial de 7 dias. El sparkline solo cambia en el origen cada ~6 horas
// (ver el comentario de la URL en prices.go): reenviar ~168 numeros por
// moneda en CADA tick del WebSocket (cada 5-15s) no trae un dato mas fresco,
// solo infla el mensaje a cada cliente conectado. Las sparklines de la
// pantalla se alimentan por REST (GET /crypto/prices), que si las incluye.
func sinSparkline(prices map[string]*crypto.PriceData) map[string]*crypto.PriceData {
	liviano := make(map[string]*crypto.PriceData, len(prices))
	for symbol, p := range prices {
		if p == nil {
			continue
		}
		copia := *p
		copia.Sparkline7d = nil
		liviano[symbol] = &copia
	}
	return liviano
}
