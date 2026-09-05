package crypto

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// Un proveedor que limita (429) degradaba a "cero precios" sin dejar rastro:
// imposible de diagnosticar en produccion. La prueba fija que el fallo queda
// en el log CON el status, que es lo que distingue un rate limit de una clave
// mala.
func TestGetPrices_FalloDelProveedorQuedaEnLog(t *testing.T) {
	var buf bytes.Buffer
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&buf, nil)))
	defer slog.SetDefault(prev)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusTooManyRequests)
	}))
	defer srv.Close()

	ps := NewPriceService()
	ps.SetBaseURL(srv.URL)
	ps.cacheTTL = 0

	prices, err := ps.GetPrices(context.Background(), []string{"BTC"})
	if err != nil {
		t.Fatalf("GetPrices() con proveedor en 429 debe degradar, no fallar: %v", err)
	}
	if len(prices) != 0 {
		t.Fatalf("sin cache previa se esperaban 0 precios, llegaron %d", len(prices))
	}
	if !strings.Contains(buf.String(), "status=429") {
		t.Fatalf("el log no registro el status del proveedor; log: %s", buf.String())
	}
}

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

// Las claves Demo y Pro de CoinGecko NO son intercambiables: cada una viaja en
// su propia cabecera y la Pro ademas cambia de host. Estas pruebas fijan que
// cabecera manda cada modo contra el stub.
func TestPriceService_ClaveDemoViajaEnSuCabecera(t *testing.T) {
	cabeceras := make(chan [2]string, 1)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case cabeceras <- [2]string{r.Header.Get("x-cg-demo-api-key"), r.Header.Get("x-cg-pro-api-key")}:
		default:
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"bitcoin":{"usd":65000}}`))
	}))
	defer srv.Close()

	ps := NewPriceService()
	ps.SetDemoAPIKey("CG-demo-123")
	ps.SetBaseURL(srv.URL)

	if _, err := ps.GetPrices(context.Background(), []string{"BTC"}); err != nil {
		t.Fatalf("GetPrices: %v", err)
	}
	got := <-cabeceras
	if got[0] != "CG-demo-123" {
		t.Errorf("x-cg-demo-api-key = %q, se esperaba la clave demo", got[0])
	}
	if got[1] != "" {
		t.Errorf("x-cg-pro-api-key = %q, no debia viajar en modo demo", got[1])
	}
}

func TestPriceService_ClaveProViajaEnSuCabecera(t *testing.T) {
	cabeceras := make(chan [2]string, 1)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case cabeceras <- [2]string{r.Header.Get("x-cg-demo-api-key"), r.Header.Get("x-cg-pro-api-key")}:
		default:
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"bitcoin":{"usd":65000}}`))
	}))
	defer srv.Close()

	ps := NewPriceService()
	ps.SetAPIKey("CG-pro-456")
	ps.SetBaseURL(srv.URL)

	if _, err := ps.GetPrices(context.Background(), []string{"BTC"}); err != nil {
		t.Fatalf("GetPrices: %v", err)
	}
	got := <-cabeceras
	if got[1] != "CG-pro-456" {
		t.Errorf("x-cg-pro-api-key = %q, se esperaba la clave pro", got[1])
	}
	if got[0] != "" {
		t.Errorf("x-cg-demo-api-key = %q, no debia viajar en modo pro", got[0])
	}
}

// La clave Demo se queda en el host publico: mandarla al host Pro es un
// rechazo garantizado. Solo la Pro cambia de host, y un base explicito de
// pruebas manda sobre todo.
func TestResolverHost(t *testing.T) {
	casos := []struct {
		nombre string
		base   string
		clave  string
		demo   bool
		quiere string
	}{
		{"sin clave", "", "", false, coinGeckoBaseURL},
		{"clave demo se queda en el publico", "", "CG-demo", true, coinGeckoBaseURL},
		{"clave pro va al host pro", "", "CG-pro", false, coinGeckoProBaseURL},
		{"el base de pruebas manda", "http://stub.local", "CG-pro", false, "http://stub.local"},
	}
	for _, c := range casos {
		if got := resolverHost(c.base, c.clave, c.demo); got != c.quiere {
			t.Errorf("%s: resolverHost = %q, se esperaba %q", c.nombre, got, c.quiere)
		}
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

	// Pre-populate cache. El sello va junto con el precio: GetPrice se niega a
	// operar contra un dato sin fecha o vencido (ver ErrPrecioViejo).
	ps.mu.Lock()
	ps.cache["ETH"] = &PriceData{Symbol: "ETH", Price: 3500.0}
	ps.cachedAt["ETH"] = time.Now()
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

// La cuota Demo es mensual (10k llamadas): el TTL del cache es la unica
// valvula que la respeta. Pro paga por frescura y el keyless no tiene cuota
// que cuidar pero si un 429 seguro — cada plan con su ritmo.
func TestCacheTTLPorPlan(t *testing.T) {
	sinClave := NewPriceService()
	if sinClave.cacheTTL != 5*time.Minute {
		t.Fatalf("sin clave: TTL = %v, esperaba 5m", sinClave.cacheTTL)
	}

	demo := NewPriceService()
	demo.SetDemoAPIKey("CG-demo")
	if demo.cacheTTL != 5*time.Minute {
		t.Fatalf("demo: TTL = %v, esperaba 5m", demo.cacheTTL)
	}

	pro := NewPriceService()
	pro.SetAPIKey("CG-pro")
	if pro.cacheTTL != 30*time.Second {
		t.Fatalf("pro: TTL = %v, esperaba 30s", pro.cacheTTL)
	}
}

// Servidor que imita a CoinGecko en /ping: acepta la clave solo bajo la
// cabecera del plan indicado (demo o pro) y responde 401 a la otra, como hace
// el proveedor real. En /simple/price devuelve un precio y deja ver la cabecera.
func servidorCoinGecko(t *testing.T, aceptaDemo, aceptaPro bool, cabeceras chan<- [2]string) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		demo, pro := r.Header.Get("x-cg-demo-api-key"), r.Header.Get("x-cg-pro-api-key")
		w.Header().Set("Content-Type", "application/json")
		if strings.HasSuffix(r.URL.Path, "/ping") {
			if (demo != "" && aceptaDemo) || (pro != "" && aceptaPro) {
				_, _ = w.Write([]byte(`{"gecko_says":"(V3) To the Moon!"}`))
				return
			}
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = w.Write([]byte(`{"status":{"error_code":10002,"error_message":"API Key Missing"}}`))
			return
		}
		if cabeceras != nil {
			select {
			case cabeceras <- [2]string{demo, pro}:
			default:
			}
		}
		_, _ = w.Write([]byte(`{"bitcoin":{"usd":65000}}`))
	}))
}

func TestAutoDetectPlan_ClaveDemoEnVariablePro(t *testing.T) {
	cabeceras := make(chan [2]string, 1)
	srv := servidorCoinGecko(t, true, false, cabeceras)
	defer srv.Close()

	ps := NewPriceService()
	ps.SetAPIKey("CG-demo-1234") // configurada como Pro por error
	ps.SetBaseURL(srv.URL)

	plan, st, err := ps.AutoDetectPlan(context.Background())
	if err != nil {
		t.Fatalf("AutoDetectPlan: %v", err)
	}
	if plan != PlanDemo || st != http.StatusOK {
		t.Fatalf("plan=%s status=%d, esperaba demo/200", plan, st)
	}
	if _, err := ps.GetPrices(context.Background(), []string{"BTC"}); err != nil {
		t.Fatalf("GetPrices: %v", err)
	}
	got := <-cabeceras
	if got[0] != "CG-demo-1234" || got[1] != "" {
		t.Fatalf("tras la deteccion la clave debe viajar como Demo, viajo demo=%q pro=%q", got[0], got[1])
	}
	d := ps.Diagnostics()
	if d.Plan != PlanDemo {
		t.Fatalf("diagnostico %+v: esperaba plan demo", d)
	}
	// /health es publico: nada del diagnostico puede contener la clave, ni
	// entera ni en pedazos.
	if strings.Contains(fmt.Sprintf("%+v", d), "1234") {
		t.Fatalf("el diagnostico %+v contiene parte de la clave", d)
	}
}

func TestAutoDetectPlan_ClaveProEnVariableDemo(t *testing.T) {
	srv := servidorCoinGecko(t, false, true, nil)
	defer srv.Close()

	ps := NewPriceService()
	ps.SetDemoAPIKey("CG-pro-9999")
	ps.SetBaseURL(srv.URL)

	plan, _, err := ps.AutoDetectPlan(context.Background())
	if err != nil || plan != PlanPro {
		t.Fatalf("plan=%s err=%v, esperaba pro", plan, err)
	}
	if ps.GetInterval() != 5*time.Second {
		t.Fatalf("un plan Pro detectado debe usar el intervalo rapido, dio %s", ps.GetInterval())
	}
}

func TestAutoDetectPlan_ClaveInvalidaEnLosDosPlanes(t *testing.T) {
	srv := servidorCoinGecko(t, false, false, nil)
	defer srv.Close()

	ps := NewPriceService()
	ps.SetDemoAPIKey("CG-mala")
	ps.SetBaseURL(srv.URL)

	plan, st, err := ps.AutoDetectPlan(context.Background())
	if err != nil || plan != PlanInvalid || st != http.StatusUnauthorized {
		t.Fatalf("plan=%s status=%d err=%v, esperaba invalid/401", plan, st, err)
	}
	d := ps.Diagnostics()
	if d.Plan != PlanInvalid || d.LastStatus != http.StatusUnauthorized || d.LastError == "" {
		t.Fatalf("diagnostico %+v: debe decir invalid, 401 y un motivo", d)
	}
}

func TestAutoDetectPlan_SinClaveNoConsulta(t *testing.T) {
	llamadas := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { llamadas++ }))
	defer srv.Close()

	ps := NewPriceService()
	ps.SetBaseURL(srv.URL)
	plan, _, err := ps.AutoDetectPlan(context.Background())
	if err != nil || plan != PlanNone || llamadas != 0 {
		t.Fatalf("plan=%s err=%v llamadas=%d, esperaba none sin consultar", plan, err, llamadas)
	}
}

func TestAutoDetectPlan_FalloDeRedNoCambiaNada(t *testing.T) {
	srv := servidorCoinGecko(t, true, true, nil)
	srv.Close() // cerrado a proposito: la red falla

	ps := NewPriceService()
	ps.SetAPIKey("CG-pro-1")
	ps.SetBaseURL(srv.URL)
	plan, _, err := ps.AutoDetectPlan(context.Background())
	if err == nil {
		t.Fatal("esperaba error de red")
	}
	if plan != PlanPro || ps.Diagnostics().Plan != PlanPro {
		t.Fatalf("con la red caida el plan configurado debe quedar como estaba, dio %s", plan)
	}
}

func TestDiagnostics_RegistraElUltimoEstadoDelProveedor(t *testing.T) {
	status := http.StatusInternalServerError
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = w.Write([]byte(`{"bitcoin":{"usd":65000}}`))
	}))
	defer srv.Close()

	ps := NewPriceService()
	ps.SetBaseURL(srv.URL)
	_, _ = ps.GetPrices(context.Background(), []string{"BTC"})
	if d := ps.Diagnostics(); d.LastStatus != http.StatusInternalServerError || d.LastSuccessAt != "" || d.CachedAssets != 0 {
		t.Fatalf("tras un 500: %+v", d)
	}
	status = http.StatusOK
	if _, err := ps.GetPrices(context.Background(), []string{"BTC"}); err != nil {
		t.Fatalf("GetPrices: %v", err)
	}
	if d := ps.Diagnostics(); d.LastStatus != http.StatusOK || d.LastSuccessAt == "" || d.CachedAssets != 1 {
		t.Fatalf("tras un 200: %+v", d)
	}
}

// El mapa que sale de GetPrices no puede ser el mapa interno: los caminos
// degradados devolvian ps.cache vivo y el llamador (el hub del WebSocket y el
// handler HTTP, dos goroutines sobre la misma instancia) lo serializaba
// mientras fetchFromAPI escribia. Iterar y escribir un mapa a la vez es un
// throw del runtime que mata el proceso entero, no un panic que se atrape.
//
// La prueba no persigue la carrera (seria intermitente y aqui no hay -race):
// fija el invariante que la evita, escribiendo en la cache DESPUES de recibir
// el mapa. Con el codigo viejo el mapa devuelto cambiaba con ella.
func TestGetPrices_NoDevuelveElMapaInterno(t *testing.T) {
	casos := []struct {
		nombre string
		montar func(ps *PriceService, srv *httptest.Server)
	}{
		{"breaker abierto", func(ps *PriceService, _ *httptest.Server) {
			ps.mu.Lock()
			ps.circuitOpenUntil = time.Now().Add(time.Minute)
			ps.mu.Unlock()
		}},
		{"proveedor en 500", func(ps *PriceService, srv *httptest.Server) {
			ps.SetBaseURL(srv.URL)
			ps.cacheTTL = 0
		}},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(http.StatusInternalServerError)
			}))
			defer srv.Close()

			ps := NewPriceService()
			ps.mu.Lock()
			ps.cache["BTC"] = &PriceData{Symbol: "BTC", Price: 65000}
			ps.mu.Unlock()
			c.montar(ps, srv)

			devuelto, err := ps.GetPrices(context.Background(), []string{"BTC"})
			if err != nil {
				t.Fatalf("GetPrices: %v", err)
			}
			antes := len(devuelto)

			// Escritura como la de fetchFromAPI tras un exito.
			ps.mu.Lock()
			ps.cache["ETH"] = &PriceData{Symbol: "ETH", Price: 3000}
			ps.mu.Unlock()

			if len(devuelto) != antes {
				t.Fatalf("el mapa devuelto cambio de %d a %d entradas: es el mapa interno, no una copia", antes, len(devuelto))
			}
		})
	}
}

// sembrarPrecio deja un precio en cache con la edad pedida y el cache de
// GetPrices "fresco", para que la prueba no salga a la red: lo que se examina
// es la edad del dato, no el camino de red.
func sembrarPrecio(ps *PriceService, symbol string, precio float64, edad time.Duration) {
	ps.mu.Lock()
	defer ps.mu.Unlock()
	ps.cache[symbol] = &PriceData{Symbol: symbol, Price: precio}
	ps.cachedAt[symbol] = time.Now().Add(-edad)
	ps.lastFetch = time.Now()
}

// El defecto: GetPrices degrada al cache SIN error cuando el proveedor falla
// (breaker abierto, 429, clave rechazada), y GetPrice devolvia ese numero tal
// cual. Como GetPrice es el precio con el que se compra y se vende de verdad,
// una orden real se ejecutaba contra un precio de hace semanas — que es
// exactamente lo que paso en produccion.
func TestGetPrice_NoCobraContraUnPrecioViejo(t *testing.T) {
	ps := NewPriceService()
	ps.cacheTTL = time.Minute
	sembrarPrecio(ps, "BTC", 65000, time.Hour)

	precio, err := ps.GetPrice(context.Background(), "BTC")
	if err == nil {
		t.Fatalf("GetPrice devolvio %v de hace una hora sin error: una compra real se ejecuta contra ese numero", precio)
	}
	if !errors.Is(err, ErrPrecioViejo) {
		t.Fatalf("err = %v, se esperaba ErrPrecioViejo", err)
	}
	if precio != 0 {
		t.Fatalf("con error el precio debe ser 0, dio %v", precio)
	}
}

// Un precio dentro de la ventana se cobra igual que siempre: el corte no puede
// dejar la compra inservible cuando el feed responde.
func TestGetPrice_PrecioFrescoSeSigueCobrando(t *testing.T) {
	ps := NewPriceService()
	ps.cacheTTL = time.Minute
	sembrarPrecio(ps, "BTC", 65000, 10*time.Second)

	precio, err := ps.GetPrice(context.Background(), "BTC")
	if err != nil {
		t.Fatalf("GetPrice con un precio de 10s: %v", err)
	}
	if precio != 65000 {
		t.Fatalf("precio = %v, se esperaba 65000", precio)
	}
}

// La pantalla es otro caso: mostrar un precio viejo es aceptable, cobrar
// contra el no. GetPrices debe seguir sirviendo el dato degradado sin error.
func TestGetPrices_SigueSirviendoElPrecioViejo(t *testing.T) {
	ps := NewPriceService()
	ps.cacheTTL = time.Minute
	sembrarPrecio(ps, "BTC", 65000, time.Hour)

	prices, err := ps.GetPrices(context.Background(), []string{"BTC"})
	if err != nil {
		t.Fatalf("GetPrices no puede fallar por un dato viejo: %v", err)
	}
	if p, ok := prices["BTC"]; !ok || p.Price != 65000 {
		t.Fatalf("prices = %+v, se esperaba BTC a 65000 para la pantalla", prices)
	}
}

// Un simbolo del que nunca llego precio no tiene con que probar frescura: se
// trata como vencido en vez de darlo por bueno.
func TestGetPrice_SinSelloCuentaComoViejo(t *testing.T) {
	ps := NewPriceService()
	ps.cacheTTL = time.Minute
	ps.mu.Lock()
	ps.cache["BTC"] = &PriceData{Symbol: "BTC", Price: 65000}
	ps.lastFetch = time.Now()
	ps.mu.Unlock()

	if _, err := ps.GetPrice(context.Background(), "BTC"); !errors.Is(err, ErrPrecioViejo) {
		t.Fatalf("err = %v, un precio sin fecha debe rechazarse como viejo", err)
	}
}

// La ventana se mide contra el TTL del plan (Demo tolera mas porque refresca
// menos), con un piso para que un precio recien traido nunca cuente como
// viejo aunque el cache este apagado.
func TestEdadMaximaPorPlan(t *testing.T) {
	casos := []struct {
		nombre string
		ttl    time.Duration
		quiere time.Duration
	}{
		{"demo/sin clave (5m)", 5 * time.Minute, 15 * time.Minute},
		{"pro (30s)", 30 * time.Second, 90 * time.Second},
		{"cache apagado", 0, edadMaximaMinima},
	}
	for _, c := range casos {
		ps := NewPriceService()
		ps.cacheTTL = c.ttl
		if got := ps.edadMaxima(); got != c.quiere {
			t.Errorf("%s: edadMaxima = %s, se esperaba %s", c.nombre, got, c.quiere)
		}
	}
}

// El corte tiene que llegar hasta el camino de compra/venta/conversion, que es
// quien cobra: precioEn no puede tragarse el precio viejo y convertirlo en un
// "no hay precio" generico.
func TestPrecioEn_PropagaElPrecioViejo(t *testing.T) {
	ps := NewPriceService()
	ps.cacheTTL = time.Minute
	sembrarPrecio(ps, "BTC", 65000, time.Hour)

	s := &Service{prices: ps}
	if _, err := s.precioEn(context.Background(), "BTC", "USD"); !errors.Is(err, ErrPrecioViejo) {
		t.Fatalf("err = %v, se esperaba ErrPrecioViejo hasta el camino de compra", err)
	}
}

// Y que llegue al cliente con codigo propio: un proveedor caido hace semanas
// no es lo mismo que un activo que no cotiza, y quien lea el error tiene que
// poder distinguirlos.
func TestErrorDePrecio_PrecioViejoTieneCodigoPropio(t *testing.T) {
	codigo, estado, ok := errorDePrecio(fmt.Errorf("envuelto: %w", ErrPrecioViejo))
	if !ok || codigo != "PRICE_STALE" || estado != http.StatusServiceUnavailable {
		t.Fatalf("codigo=%q estado=%d ok=%v, se esperaba PRICE_STALE/503", codigo, estado, ok)
	}
	if otro, _, _ := errorDePrecio(ErrSinPrecio); otro == codigo {
		t.Fatalf("un precio viejo y un activo sin precio no pueden compartir el codigo %q", codigo)
	}
}
