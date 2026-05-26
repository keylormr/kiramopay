package crypto

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"
)

// PriceService fetches real crypto prices from CoinGecko with circuit breaker.
type PriceService struct {
	cache               map[string]*PriceData
	mu                  sync.RWMutex
	lastFetch           time.Time
	cacheTTL            time.Duration
	apiKey              string
	consecutiveFailures int
	circuitOpenUntil    time.Time
}

func NewPriceService() *PriceService {
	return &PriceService{
		cache:    make(map[string]*PriceData),
		cacheTTL: 60 * time.Second, // Increased from 30s for free tier
	}
}

// SetAPIKey sets the CoinGecko Pro API key for higher rate limits.
func (ps *PriceService) SetAPIKey(key string) {
	ps.mu.Lock()
	defer ps.mu.Unlock()
	ps.apiKey = key
}

// Supported coins mapped to CoinGecko IDs
var coinGeckoIDs = map[string]string{
	"BTC":   "bitcoin",
	"ETH":   "ethereum",
	"SOL":   "solana",
	"ADA":   "cardano",
	"DOT":   "polkadot",
	"AVAX":  "avalanche-2",
	"LINK":  "chainlink",
	"MATIC": "matic-network",
	"UNI":   "uniswap",
	"ATOM":  "cosmos",
}

func (ps *PriceService) GetPrices(symbols []string) (map[string]*PriceData, error) {
	ps.mu.RLock()
	if time.Since(ps.lastFetch) < ps.cacheTTL && len(ps.cache) > 0 {
		result := make(map[string]*PriceData)
		for _, s := range symbols {
			if p, ok := ps.cache[s]; ok {
				result[s] = p
			}
		}
		ps.mu.RUnlock()
		if len(result) > 0 {
			return result, nil
		}
	} else {
		ps.mu.RUnlock()
	}

	// Check circuit breaker
	ps.mu.RLock()
	circuitOpen := time.Now().Before(ps.circuitOpenUntil)
	ps.mu.RUnlock()
	if circuitOpen {
		slog.Warn("circuit breaker open, returning cached prices")
		ps.mu.RLock()
		defer ps.mu.RUnlock()
		return ps.cache, nil
	}

	return ps.fetchFromAPI(symbols)
}

func (ps *PriceService) fetchFromAPI(symbols []string) (map[string]*PriceData, error) {
	// Build CoinGecko IDs list
	var ids []string
	symbolToID := make(map[string]string)
	for _, s := range symbols {
		if id, ok := coinGeckoIDs[s]; ok {
			ids = append(ids, id)
			symbolToID[id] = s
		}
	}

	if len(ids) == 0 {
		return map[string]*PriceData{}, nil
	}

	url := fmt.Sprintf(
		"https://api.coingecko.com/api/v3/simple/price?ids=%s&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true&include_market_cap=true",
		strings.Join(ids, ","),
	)

	// Use Pro API if key is configured
	ps.mu.RLock()
	apiKey := ps.apiKey
	ps.mu.RUnlock()

	if apiKey != "" {
		url = fmt.Sprintf(
			"https://pro-api.coingecko.com/api/v3/simple/price?ids=%s&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true&include_market_cap=true",
			strings.Join(ids, ","),
		)
	}

	client := &http.Client{Timeout: 10 * time.Second}
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		ps.recordFailure()
		ps.mu.RLock()
		defer ps.mu.RUnlock()
		return ps.cache, nil
	}

	if apiKey != "" {
		req.Header.Set("x-cg-pro-api-key", apiKey)
	}

	resp, err := client.Do(req)
	if err != nil {
		ps.recordFailure()
		ps.mu.RLock()
		defer ps.mu.RUnlock()
		return ps.cache, nil
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		ps.recordFailure()
		ps.mu.RLock()
		defer ps.mu.RUnlock()
		return ps.cache, nil
	}

	var data map[string]struct {
		USD          float64 `json:"usd"`
		USD24hChange float64 `json:"usd_24h_change"`
		USD24hVol    float64 `json:"usd_24h_vol"`
		USDMarketCap float64 `json:"usd_market_cap"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		ps.recordFailure()
		return ps.cache, nil
	}

	result := make(map[string]*PriceData)
	ps.mu.Lock()
	defer ps.mu.Unlock()

	for cgID, prices := range data {
		symbol := symbolToID[cgID]
		pd := &PriceData{
			Symbol:    symbol,
			Price:     prices.USD,
			Change24h: prices.USD24hChange,
			Volume24h: prices.USD24hVol,
			MarketCap: prices.USDMarketCap,
		}
		result[symbol] = pd
		ps.cache[symbol] = pd
	}

	ps.lastFetch = time.Now()
	ps.consecutiveFailures = 0 // Reset on success
	return result, nil
}

func (ps *PriceService) recordFailure() {
	ps.mu.Lock()
	defer ps.mu.Unlock()
	ps.consecutiveFailures++
	if ps.consecutiveFailures >= 3 {
		ps.circuitOpenUntil = time.Now().Add(5 * time.Minute)
		slog.Warn("circuit breaker opened",
			"failures", ps.consecutiveFailures,
			"cooldown", "5m",
		)
	}
}

func (ps *PriceService) GetPrice(symbol string) (float64, error) {
	prices, err := ps.GetPrices([]string{symbol})
	if err != nil {
		return 0, err
	}
	if p, ok := prices[symbol]; ok {
		return p.Price, nil
	}
	return 0, fmt.Errorf("price not found for %s", symbol)
}

// GetInterval returns the recommended fetch interval based on API key.
func (ps *PriceService) GetInterval() time.Duration {
	ps.mu.RLock()
	defer ps.mu.RUnlock()
	if ps.apiKey != "" {
		return 5 * time.Second
	}
	return 15 * time.Second
}
