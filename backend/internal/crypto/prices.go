package crypto

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/kiramopay/backend/internal/observability"
)

// CoinGecko endpoints. Free tier by default; the Pro host is used when an API
// key is configured.
const (
	coinGeckoBaseURL    = "https://api.coingecko.com/api/v3"
	coinGeckoProBaseURL = "https://pro-api.coingecko.com/api/v3"
)

// Edad maxima que puede tener un precio para COBRAR contra el, en multiplos
// del TTL del cache: pasado eso el numero esta muerto. El piso evita que un
// precio recien traido cuente como viejo cuando el cache esta apagado
// (cacheTTL 0, como en varias pruebas).
const (
	factorEdadMaxima = 3
	edadMaximaMinima = 30 * time.Second
)

// ErrPrecioViejo: hay un precio en cache pero lleva demasiado sin refrescarse.
//
// GetPrices degrada al cache y NO devuelve error cuando el proveedor falla
// (breaker abierto, 429, 401), asi que una compra o una venta reales se
// ejecutaban contra el ultimo precio que llego, tuviera la edad que tuviera —
// en produccion el proveedor estuvo semanas caido. Mostrar un precio viejo en
// pantalla es aceptable; cobrar contra el no. Por eso el corte vive en
// GetPrice (el camino de compra/venta/conversion) y no en GetPrices.
var ErrPrecioViejo = errors.New("crypto price is too old to trade on")

// PriceService fetches real crypto prices from CoinGecko with circuit breaker.
type PriceService struct {
	cache map[string]*PriceData
	// cachedAt guarda cuando llego cada precio. Va aparte del PriceData porque
	// ese struct se serializa tal cual hacia el cliente y no se le agrega un
	// campo por esto.
	cachedAt            map[string]time.Time
	mu                  sync.RWMutex
	lastFetch           time.Time
	cacheTTL            time.Duration
	apiKey              string
	apiKeyDemo          bool
	baseURL             string
	consecutiveFailures int
	circuitOpenUntil    time.Time
	client              *http.Client
	// Estado para /health: ultimo status y error del proveedor, ultimo exito,
	// y si la clave fue rechazada en los dos planes al arrancar.
	lastStatus   int
	lastError    string
	lastSuccess  time.Time
	planInvalido bool
}

func NewPriceService() *PriceService {
	return &PriceService{
		cache:    make(map[string]*PriceData),
		cachedAt: make(map[string]time.Time),
		// Sin clave no hay cuota que administrar (el tier compartido igual
		// rechaza por IP); 5 minutos evita martillar en vano.
		cacheTTL: 5 * time.Minute,
		client:   observability.HTTPClient(10 * time.Second),
	}
}

// SetAPIKey sets the CoinGecko Pro API key for higher rate limits.
func (ps *PriceService) SetAPIKey(key string) {
	ps.mu.Lock()
	defer ps.mu.Unlock()
	ps.apiKey = key
	ps.apiKeyDemo = false
	// Pro paga por frescura: cache corto.
	ps.cacheTTL = 30 * time.Second
}

// SetDemoAPIKey sets a CoinGecko Demo (free tier) API key. Demo keys are NOT
// interchangeable with Pro keys: they authenticate against the PUBLIC host
// with the x-cg-demo-api-key header, and the Pro host rejects them. Without
// any key, CoinGecko rate-limits shared datacenter IPs (Render's) so hard
// that production gets a 429 on its very first request.
func (ps *PriceService) SetDemoAPIKey(key string) {
	ps.mu.Lock()
	defer ps.mu.Unlock()
	ps.apiKey = key
	ps.apiKeyDemo = true
	// La cuota Demo es 10.000 llamadas AL MES (~1 cada 4,3 min sostenido).
	// Con el cache de 60s que habia, solo el broadcaster quemaba ~43.000/mes:
	// la clave moria a mitad de mes. 5 minutos deja ~8.600/mes con margen.
	ps.cacheTTL = 5 * time.Minute
}

// resolverHost elige el host segun la clave: sin clave o con clave Demo, el
// publico; con clave Pro, el de pago. Un base explicito (pruebas) manda.
func resolverHost(base, apiKey string, demo bool) string {
	if base != "" {
		return base
	}
	if apiKey != "" && !demo {
		return coinGeckoProBaseURL
	}
	return coinGeckoBaseURL
}

// SetBaseURL points the service at another host that speaks the CoinGecko
// simple/price API. Empty restores the default endpoint.
//
// Exists so the tests can serve their own prices instead of reaching
// api.coingecko.com: the free tier rate-limits, the circuit breaker opens and
// the test fails for reasons that have nothing to do with the change under
// test. Nothing in production calls this.
func (ps *PriceService) SetBaseURL(url string) {
	ps.mu.Lock()
	defer ps.mu.Unlock()
	ps.baseURL = strings.TrimSuffix(url, "/")
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

// copiaDeCache devuelve una COPIA del mapa de precios. Los caminos degradados
// devolvian ps.cache, el mapa vivo: el `defer RUnlock` suelta el lock al
// retornar, asi que el llamador (el hub del WebSocket y el handler HTTP, dos
// goroutines sobre la MISMA instancia) lo serializaba mientras fetchFromAPI
// escribia en el. Iterar y escribir un mapa a la vez no es un panic que el
// Recoverer atrape: es un throw del runtime que mata el proceso entero, toda
// la API y no solo cripto. Reproducido.
//
// Los *PriceData se comparten a proposito: se reemplazan enteros en cada
// escritura, nunca se mutan en sitio.
func (ps *PriceService) copiaDeCache() map[string]*PriceData {
	ps.mu.RLock()
	defer ps.mu.RUnlock()
	copia := make(map[string]*PriceData, len(ps.cache))
	for k, v := range ps.cache {
		copia[k] = v
	}
	return copia
}

func (ps *PriceService) GetPrices(ctx context.Context, symbols []string) (map[string]*PriceData, error) {
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
		// Debug, no Warn: el broadcaster consulta cada pocos segundos y con el
		// breaker abierto esto inundaba el log (un WARN cada 5s por minutos).
		// La APERTURA del breaker si se loguea como Warn, una sola vez.
		slog.Debug("circuit breaker open, returning cached prices")
		return ps.copiaDeCache(), nil
	}

	return ps.fetchFromAPI(ctx, symbols)
}

func (ps *PriceService) fetchFromAPI(ctx context.Context, symbols []string) (map[string]*PriceData, error) {
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

	ps.mu.RLock()
	apiKey := ps.apiKey
	demo := ps.apiKeyDemo
	base := resolverHost(ps.baseURL, ps.apiKey, ps.apiKeyDemo)
	ps.mu.RUnlock()

	url := fmt.Sprintf(
		"%s/simple/price?ids=%s&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true&include_market_cap=true",
		base, strings.Join(ids, ","),
	)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		slog.Warn("price fetch: building request failed", "err", err)
		ps.recordFailure()
		return ps.copiaDeCache(), nil
	}

	if apiKey != "" {
		if demo {
			req.Header.Set("x-cg-demo-api-key", apiKey)
		} else {
			req.Header.Set("x-cg-pro-api-key", apiKey)
		}
	}

	resp, err := ps.client.Do(req)
	if err != nil {
		// Sin este log, un CoinGecko caido o limitando se veia como "no hay
		// precios" sin causa: el servicio degrada en silencio a la cache (que
		// arranca vacia) y nadie se entera. Paso hoy en produccion.
		slog.Warn("price fetch: request failed", "host", base, "err", err)
		ps.notarResultado(0, err.Error())
		ps.recordFailure()
		return ps.copiaDeCache(), nil
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		// El status distingue las causas que importan operar distinto: 429 es
		// rate limit del tier gratis, 401/403 es una clave mala.
		if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
			// Config rota, no clima: gritarlo con la accion concreta. Una clave
			// Demo va en COINGECKO_API_KEY (host publico); una Pro de pago va
			// en COINGECKO_PRO_API_KEY (host pro-api). Cruzarlas da exactamente
			// este error.
			slog.Error("clave de CoinGecko rechazada: revisar COINGECKO_API_KEY (Demo) o COINGECKO_PRO_API_KEY (Pro) en el entorno",
				"host", base, "status", resp.StatusCode)
		} else {
			slog.Warn("price fetch: non-200 from provider", "host", base, "status", resp.StatusCode)
		}
		ps.notarResultado(resp.StatusCode, "")
		ps.recordFailure()
		return ps.copiaDeCache(), nil
	}

	var data map[string]struct {
		USD          float64 `json:"usd"`
		USD24hChange float64 `json:"usd_24h_change"`
		USD24hVol    float64 `json:"usd_24h_vol"`
		USDMarketCap float64 `json:"usd_market_cap"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		slog.Warn("price fetch: decoding response failed", "host", base, "err", err)
		ps.recordFailure()
		return ps.copiaDeCache(), nil
	}

	result := make(map[string]*PriceData)
	ps.mu.Lock()
	defer ps.mu.Unlock()

	ahora := time.Now()
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
		// El sello es POR SIMBOLO: una respuesta que trae BTC pero omite MATIC
		// deja fresco al primero y no al segundo, y un sello global mentiria
		// sobre el segundo.
		ps.cachedAt[symbol] = ahora
	}

	ps.lastFetch = ahora
	ps.lastSuccess = ps.lastFetch
	ps.lastStatus = http.StatusOK
	ps.lastError = ""
	// Una peticion que funciona desmiente el veredicto del sondeo del arranque:
	// sin esto, arreglar la clave en Render dejaba /health diciendo "invalid"
	// para siempre, aunque los precios ya estuvieran llegando.
	ps.planInvalido = false
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

// GetPrice devuelve el precio con el que SE OPERA. A diferencia de GetPrices,
// que sirve la pantalla y puede degradar a un dato viejo, aqui un precio
// vencido es un error: mas vale no ejecutar la orden que cobrarla contra un
// numero muerto.
func (ps *PriceService) GetPrice(ctx context.Context, symbol string) (float64, error) {
	prices, err := ps.GetPrices(ctx, []string{symbol})
	if err != nil {
		return 0, err
	}
	p, ok := prices[symbol]
	if !ok {
		return 0, fmt.Errorf("price not found for %s", symbol)
	}
	if edad, vencido := ps.precioVencido(symbol); vencido {
		if edad > 0 {
			return 0, fmt.Errorf("%w: %s lleva %s sin actualizarse", ErrPrecioViejo, symbol, edad.Truncate(time.Second))
		}
		return 0, fmt.Errorf("%w: %s no tiene fecha de actualizacion", ErrPrecioViejo, symbol)
	}
	return p.Price, nil
}

// precioVencido dice si el precio en cache de un simbolo esta demasiado viejo
// para operar con el, y que edad tiene. Un simbolo sin sello propio se juzga
// por el ultimo exito del feed; sin ninguno de los dos cuenta como vencido,
// porque no hay con que probar que es fresco.
func (ps *PriceService) precioVencido(symbol string) (time.Duration, bool) {
	ps.mu.RLock()
	defer ps.mu.RUnlock()
	desde, ok := ps.cachedAt[symbol]
	if !ok {
		desde = ps.lastSuccess
	}
	if desde.IsZero() {
		return 0, true
	}
	edad := time.Since(desde)
	return edad, edad > ps.edadMaxima()
}

// edadMaxima exige el lock tomado (lo llama precioVencido, que lo sostiene).
func (ps *PriceService) edadMaxima() time.Duration {
	maxima := factorEdadMaxima * ps.cacheTTL
	if maxima < edadMaximaMinima {
		maxima = edadMaximaMinima
	}
	return maxima
}

// GetInterval returns the recommended fetch interval based on API key. Only a
// Pro key earns the fast interval; the Demo tier (30 req/min) keeps the same
// pace as the keyless free tier.
func (ps *PriceService) GetInterval() time.Duration {
	ps.mu.RLock()
	defer ps.mu.RUnlock()
	if ps.apiKey != "" && !ps.apiKeyDemo {
		return 5 * time.Second
	}
	return 15 * time.Second
}
