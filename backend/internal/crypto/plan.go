package crypto

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"time"
)

// Planes de CoinGecko tal como los ve el servicio. La variable de entorno
// dice de que plan es la clave, pero se equivoca con facilidad (una Demo en
// COINGECKO_PRO_API_KEY va al host Pro y recibe 401 "API Key Missing" en cada
// llamada): por eso el plan se comprueba contra el proveedor al arrancar y se
// expone en /health.
const (
	PlanNone    = "none"
	PlanDemo    = "demo"
	PlanPro     = "pro"
	PlanInvalid = "invalid"
)

// Diagnostics es la foto del servicio de precios que sale en /health. Nunca
// lleva la clave completa: solo sus ultimos 4 caracteres para reconocerla.
type Diagnostics struct {
	Plan          string `json:"plan"`
	Key           string `json:"key"`
	LastStatus    int    `json:"last_status"`
	LastError     string `json:"last_error"`
	LastSuccessAt string `json:"last_success_at"`
	CachedAssets  int    `json:"cached_assets"`
	BreakerOpen   bool   `json:"breaker_open"`
}

func huella(key string) string {
	if key == "" {
		return ""
	}
	if len(key) <= 4 {
		return "…" + key
	}
	return "…" + key[len(key)-4:]
}

func (ps *PriceService) planConfigurado() string {
	switch {
	case ps.apiKey == "":
		return PlanNone
	case ps.apiKeyDemo:
		return PlanDemo
	default:
		return PlanPro
	}
}

// Diagnostics devuelve el estado actual sin tocar la red.
func (ps *PriceService) Diagnostics() Diagnostics {
	ps.mu.RLock()
	defer ps.mu.RUnlock()
	plan := ps.planConfigurado()
	if ps.planInvalido {
		plan = PlanInvalid
	}
	d := Diagnostics{
		Plan:         plan,
		Key:          huella(ps.apiKey),
		LastStatus:   ps.lastStatus,
		LastError:    ps.lastError,
		CachedAssets: len(ps.cache),
		BreakerOpen:  time.Now().Before(ps.circuitOpenUntil),
	}
	if !ps.lastSuccess.IsZero() {
		d.LastSuccessAt = ps.lastSuccess.UTC().Format(time.RFC3339)
	}
	return d
}

// notarResultado guarda el ultimo estado HTTP y error del proveedor para que
// /health pueda contarlo. status 0 significa que la peticion no llego a tener
// respuesta.
func (ps *PriceService) notarResultado(status int, errText string) {
	ps.mu.Lock()
	defer ps.mu.Unlock()
	ps.lastStatus = status
	ps.lastError = errText
}

// probe pregunta a /ping con la clave en la cabecera del plan indicado. A
// diferencia de /simple/price (que en el host publico ignora una clave Demo
// mala y responde 200 igual), /ping valida la clave en los dos hosts: 200 si
// es buena para ese plan, 401 si no.
func (ps *PriceService) probe(ctx context.Context, base, key string, demo bool) (int, error) {
	url := resolverHost(base, key, demo) + "/ping"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return 0, err
	}
	if demo {
		req.Header.Set("x-cg-demo-api-key", key)
	} else {
		req.Header.Set("x-cg-pro-api-key", key)
	}
	resp, err := ps.client.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	return resp.StatusCode, nil
}

// AutoDetectPlan comprueba la clave contra el proveedor: primero con el plan
// que dice la configuracion y, si ese host la rechaza, con el otro. Si el otro
// la acepta, el servicio cambia de plan solo y lo deja escrito en el log: la
// clave estaba en la variable equivocada. Devuelve el plan vigente y el ultimo
// estado HTTP visto. Un fallo de red no cambia nada (no hay con que decidir).
func (ps *PriceService) AutoDetectPlan(ctx context.Context) (string, int, error) {
	ps.mu.RLock()
	key, demo, base := ps.apiKey, ps.apiKeyDemo, ps.baseURL
	ps.mu.RUnlock()
	if key == "" {
		return PlanNone, 0, nil
	}

	ultimo := 0
	for _, probarDemo := range []bool{demo, !demo} {
		st, err := ps.probe(ctx, base, key, probarDemo)
		if err != nil {
			return ps.planActual(), 0, fmt.Errorf("probe coingecko: %w", err)
		}
		ultimo = st
		if st == http.StatusOK {
			if probarDemo != demo {
				if probarDemo {
					slog.Warn("clave de CoinGecko puesta como Pro pero es Demo: se usa como Demo (moverla a COINGECKO_API_KEY)")
					ps.SetDemoAPIKey(key)
				} else {
					slog.Warn("clave de CoinGecko puesta como Demo pero es Pro: se usa como Pro (moverla a COINGECKO_PRO_API_KEY)")
					ps.SetAPIKey(key)
				}
			}
			ps.mu.Lock()
			ps.planInvalido = false
			ps.lastStatus = st
			ps.lastError = ""
			ps.mu.Unlock()
			return ps.planActual(), st, nil
		}
		if st != http.StatusUnauthorized && st != http.StatusForbidden {
			// 429 u otro: no dice nada sobre el plan; se deja como esta.
			ps.notarResultado(st, "")
			return ps.planActual(), st, nil
		}
	}
	// Los dos hosts la rechazan: la clave no sirve en ningun plan.
	ps.mu.Lock()
	ps.planInvalido = true
	ps.lastStatus = ultimo
	ps.lastError = "clave rechazada por CoinGecko en los dos planes"
	ps.mu.Unlock()
	slog.Error("clave de CoinGecko rechazada en el host Demo y en el Pro: revisar el valor en Render", "status", ultimo, "key", huella(key))
	return PlanInvalid, ultimo, nil
}

func (ps *PriceService) planActual() string {
	ps.mu.RLock()
	defer ps.mu.RUnlock()
	if ps.planInvalido {
		return PlanInvalid
	}
	return ps.planConfigurado()
}
