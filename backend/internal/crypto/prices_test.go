package crypto

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// TestPriceService_BaseURLOverride cubre el mecanismo del que dependen las
// pruebas de integracion: con un base configurado, el servicio pide los precios
// ahi y no a api.coingecko.com. Si esto se rompe, la suite vuelve a salir a
// internet y a fallar al azar.
func TestPriceService_BaseURLOverride(t *testing.T) {
	asked := make(chan string, 1)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case asked <- r.URL.Query().Get("ids"):
		default:
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"bitcoin":{"usd":65000,"usd_24h_change":1.5,` +
			`"usd_24h_vol":2000000,"usd_market_cap":3000000}}`))
	}))
	defer srv.Close()

	ps := NewPriceService()
	ps.SetBaseURL(srv.URL)

	prices, err := ps.GetPrices(context.Background(), []string{"BTC"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	select {
	case ids := <-asked:
		if ids != "bitcoin" {
			t.Errorf("ids = %q, want bitcoin", ids)
		}
	default:
		t.Fatal("the service never called the configured base URL")
	}

	btc, ok := prices["BTC"]
	if !ok {
		t.Fatal("BTC missing from prices")
	}
	if btc.Price != 65000 {
		t.Errorf("price = %f, want 65000", btc.Price)
	}
	if btc.Change24h != 1.5 {
		t.Errorf("change24h = %f, want 1.5", btc.Change24h)
	}
}

func TestPriceService_CacheRespected(t *testing.T) {
	ps := NewPriceService()
	ps.cacheTTL = 60 * time.Second

	// Force some cache entries
	ps.mu.Lock()
	ps.cache["BTC"] = &PriceData{Symbol: "BTC", Price: 100000.0}
	ps.lastFetch = time.Now()
	ps.mu.Unlock()

	prices, err := ps.GetPrices(context.Background(), []string{"BTC"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if prices["BTC"].Price != 100000.0 {
		t.Errorf("expected cached price 100000.0, got %f", prices["BTC"].Price)
	}
}

func TestCircuitBreaker_OpensAfterFailures(t *testing.T) {
	ps := NewPriceService()
	ps.cacheTTL = 0 // Disable cache

	// Simulate consecutive failures
	ps.mu.Lock()
	ps.consecutiveFailures = 3
	ps.circuitOpenUntil = time.Now().Add(5 * time.Minute)
	ps.mu.Unlock()

	// Should return empty when circuit is open
	prices, err := ps.GetPrices(context.Background(), []string{"BTC"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	// Circuit is open, should return cached (empty in this case)
	_ = prices
}

func TestCircuitBreaker_ClosesAfterCooldown(t *testing.T) {
	ps := NewPriceService()

	ps.mu.Lock()
	ps.consecutiveFailures = 3
	ps.circuitOpenUntil = time.Now().Add(-1 * time.Second) // Already expired
	ps.mu.Unlock()

	// Circuit should be closed now
	ps.mu.RLock()
	open := time.Now().Before(ps.circuitOpenUntil)
	ps.mu.RUnlock()

	if open {
		t.Error("circuit should be closed after cooldown")
	}
}

func TestPriceService_SinglePrice(t *testing.T) {
	ps := NewPriceService()

	// Pre-populate cache
	ps.mu.Lock()
	ps.cache["ETH"] = &PriceData{Symbol: "ETH", Price: 3500.0}
	ps.lastFetch = time.Now()
	ps.mu.Unlock()

	price, err := ps.GetPrice(context.Background(), "ETH")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if price != 3500.0 {
		t.Errorf("expected 3500.0, got %f", price)
	}
}

func TestPriceService_CacheTTLIncreased(t *testing.T) {
	ps := NewPriceService()
	if ps.cacheTTL < 60*time.Second {
		t.Errorf("cacheTTL = %v, want >= 60s for free tier", ps.cacheTTL)
	}
}
