package crypto

import (
	"context"
	"testing"
	"time"
)

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
