package exchange

import (
	"context"
	"fmt"
	"testing"
	"time"
)

// mockProvider implements RateProvider for tests.
type mockProvider struct {
	rates  map[string]float64
	calls  int
	fail   bool
}

func (m *mockProvider) FetchRates(_ context.Context, base string, targets []string) (map[string]float64, error) {
	m.calls++
	if m.fail {
		return nil, fmt.Errorf("api unavailable")
	}
	result := make(map[string]float64)
	for _, t := range targets {
		key := fmt.Sprintf("%s_%s", base, t)
		if rate, ok := m.rates[key]; ok {
			result[key] = rate
		}
	}
	return result, nil
}

func TestFetchRates_ReturnsRatesForAllCurrencies(t *testing.T) {
	provider := &mockProvider{
		rates: map[string]float64{
			"USD_CRC": 515.50,
			"USD_PAB": 1.0,
			"USD_GTQ": 7.75,
		},
	}

	svc := NewService(provider, time.Hour)
	svc.fetchAndCache()

	for _, pair := range []struct{ from, to string; min float64 }{
		{"USD", "CRC", 500},
		{"USD", "PAB", 0.9},
		{"USD", "GTQ", 7.0},
	} {
		rate, err := svc.GetRate(pair.from, pair.to)
		if err != nil {
			t.Errorf("GetRate(%s, %s) error: %v", pair.from, pair.to, err)
			continue
		}
		if rate < pair.min {
			t.Errorf("GetRate(%s, %s) = %f, want > %f", pair.from, pair.to, rate, pair.min)
		}
	}
}

func TestFallback_WhenAPIFails(t *testing.T) {
	provider := &mockProvider{
		rates: map[string]float64{
			"USD_CRC": 515.50,
		},
	}

	svc := NewService(provider, time.Hour)
	svc.fetchAndCache()

	// First fetch succeeds
	rate, err := svc.GetRate("USD", "CRC")
	if err != nil || rate != 515.50 {
		t.Fatalf("initial rate wrong: %f, %v", rate, err)
	}

	// Make provider fail
	provider.fail = true
	svc.fetchAndCache()

	// Should still have cached rates
	rate, err = svc.GetRate("USD", "CRC")
	if err != nil || rate != 515.50 {
		t.Errorf("fallback rate wrong: %f, %v", rate, err)
	}
}

func TestGetRate_SameCurrencyReturnsOne(t *testing.T) {
	svc := NewService(&mockProvider{rates: map[string]float64{}}, time.Hour)

	rate, err := svc.GetRate("CRC", "CRC")
	if err != nil {
		t.Errorf("same currency error: %v", err)
	}
	if rate != 1.0 {
		t.Errorf("same currency rate = %f, want 1.0", rate)
	}
}

func TestGoroutine_RespectsInterval(t *testing.T) {
	provider := &mockProvider{
		rates: map[string]float64{"USD_CRC": 515.50},
	}

	svc := NewService(provider, 50*time.Millisecond)
	go svc.Start()
	defer svc.Stop()

	time.Sleep(200 * time.Millisecond)

	if provider.calls < 3 {
		t.Errorf("expected at least 3 calls, got %d", provider.calls)
	}
}
