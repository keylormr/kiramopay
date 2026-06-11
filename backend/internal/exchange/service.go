package exchange

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/kiramopay/backend/internal/observability"
)

// Rate represents an exchange rate.
type Rate struct {
	From      string    `json:"from"`
	To        string    `json:"to"`
	Rate      float64   `json:"rate"`
	Source    string    `json:"source"`
	UpdatedAt time.Time `json:"updated_at"`
}

// RateProvider defines the interface for fetching exchange rates.
type RateProvider interface {
	FetchRates(ctx context.Context, base string, targets []string) (map[string]float64, error)
}

// Service manages exchange rate fetching and caching.
type Service struct {
	provider  RateProvider
	rates     map[string]float64
	mu        sync.RWMutex
	lastFetch time.Time
	interval  time.Duration
	stop      chan struct{}
}

// NewService creates a new exchange rate service.
func NewService(provider RateProvider, interval time.Duration) *Service {
	return &Service{
		provider: provider,
		rates:    make(map[string]float64),
		interval: interval,
		stop:     make(chan struct{}),
	}
}

// Start begins the periodic rate fetching goroutine.
func (s *Service) Start() {
	slog.Info("Exchange rate updater started", "interval", s.interval)
	s.fetchAndCache()

	ticker := time.NewTicker(s.interval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			s.fetchAndCache()
		case <-s.stop:
			slog.Info("Exchange rate updater stopped")
			return
		}
	}
}

// Stop halts the updater.
func (s *Service) Stop() {
	close(s.stop)
}

func (s *Service) fetchAndCache() {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	rates, err := s.provider.FetchRates(ctx, "USD", []string{"CRC", "PAB", "GTQ"})
	if err != nil {
		slog.Error("failed to fetch exchange rates", "error", err)
		return
	}

	s.mu.Lock()
	for k, v := range rates {
		s.rates[k] = v
	}
	s.lastFetch = time.Now()
	s.mu.Unlock()

	slog.Info("exchange rates updated", "count", len(rates))
}

// GetRate returns the exchange rate for a given pair.
func (s *Service) GetRate(from, to string) (float64, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if from == to {
		return 1.0, nil
	}

	key := fmt.Sprintf("%s_%s", from, to)
	if rate, ok := s.rates[key]; ok {
		return rate, nil
	}

	// Try inverse
	inverseKey := fmt.Sprintf("%s_%s", to, from)
	if rate, ok := s.rates[inverseKey]; ok && rate > 0 {
		return 1.0 / rate, nil
	}

	return 0, fmt.Errorf("exchange rate not found for %s/%s", from, to)
}

// GetAllRates returns all cached rates.
func (s *Service) GetAllRates() map[string]float64 {
	s.mu.RLock()
	defer s.mu.RUnlock()
	result := make(map[string]float64, len(s.rates))
	for k, v := range s.rates {
		result[k] = v
	}
	return result
}

// ExchangeRateAPIProvider fetches rates from exchangerate-api.com.
type ExchangeRateAPIProvider struct {
	apiKey string
	client *http.Client
}

// NewExchangeRateAPIProvider creates a new provider.
func NewExchangeRateAPIProvider(apiKey string) *ExchangeRateAPIProvider {
	return &ExchangeRateAPIProvider{
		apiKey: apiKey,
		client: observability.HTTPClient(10 * time.Second),
	}
}

// FetchRates fetches exchange rates from the API.
func (p *ExchangeRateAPIProvider) FetchRates(ctx context.Context, base string, targets []string) (map[string]float64, error) {
	url := fmt.Sprintf("https://v6.exchangerate-api.com/v6/%s/latest/%s", p.apiKey, base)
	if p.apiKey == "" {
		url = fmt.Sprintf("https://open.er-api.com/v6/latest/%s", base)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}

	resp, err := p.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("exchange rate API request failed: %w", err)
	}
	defer resp.Body.Close()

	var data struct {
		Result string             `json:"result"`
		Rates  map[string]float64 `json:"rates"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return nil, fmt.Errorf("exchange rate API decode failed: %w", err)
	}

	result := make(map[string]float64)
	for _, target := range targets {
		if rate, ok := data.Rates[target]; ok {
			key := fmt.Sprintf("%s_%s", base, target)
			result[key] = rate
		}
	}

	return result, nil
}
