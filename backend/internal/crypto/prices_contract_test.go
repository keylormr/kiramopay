package crypto_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/kiramopay/backend/internal/contract"
	"github.com/kiramopay/backend/internal/crypto"
)

// TestGetPricesResponseContract drives GET /api/v1/crypto/prices through the
// real handler against a fake CoinGecko (httptest), with a sparkline in the
// response, and checks the `data` conforms to CryptoPriceData in
// openapi.yaml. Without this, the handler and the published contract can
// drift silently — exactly what happened with the sparkline field before this
// change: the feed had no historial and nothing documented that it should.
func TestGetPricesResponseContract(t *testing.T) {
	fake := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`[{
			"id": "bitcoin",
			"current_price": 65000,
			"price_change_percentage_24h": 1.5,
			"total_volume": 2000000,
			"market_cap": 3000000,
			"high_24h": 66000,
			"low_24h": 64000,
			"sparkline_in_7d": {"price": [64000, 64500, 65000]}
		}]`))
	}))
	defer fake.Close()

	ps := crypto.NewPriceService()
	ps.SetBaseURL(fake.URL)
	svc := crypto.NewService(nil, ps, nil, nil)
	h := crypto.NewHandler(svc)

	doc, err := contract.LoadSpec("../../docs/openapi.yaml")
	if err != nil {
		t.Fatalf("load spec: %v", err)
	}
	router, err := contract.NewRouter(doc)
	if err != nil {
		t.Fatalf("router: %v", err)
	}

	const url = "http://localhost:8080/api/v1/crypto/prices?symbols=BTC"
	req := httptest.NewRequest(http.MethodGet, url, nil)
	rec := httptest.NewRecorder()
	h.GetPrices(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("GetPrices devolvio %d, se esperaba 200: %s", rec.Code, rec.Body.String())
	}

	var env struct {
		Success bool            `json:"success"`
		Data    json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("decode envelope: %v", err)
	}
	if !env.Success {
		t.Fatalf("se esperaba success=true: %s", rec.Body.String())
	}
	var data interface{}
	if err := json.Unmarshal(env.Data, &data); err != nil {
		t.Fatalf("decode data: %v", err)
	}

	if err := contract.ValidateData(router, http.MethodGet, "http://localhost:8080/api/v1/crypto/prices",
		http.StatusOK, data); err != nil {
		t.Errorf("la respuesta de /crypto/prices viola el esquema CryptoPriceData: %v", err)
	}

	// El contrato no basta para probar que el campo REALMENTE viaja (un
	// esquema con additionalProperties acepta tambien una respuesta sin el
	// campo): se confirma aparte que el sparkline llego hasta el JSON final.
	var precios map[string]crypto.PriceData
	if err := json.Unmarshal(env.Data, &precios); err != nil {
		t.Fatalf("decode precios: %v", err)
	}
	btc, ok := precios["BTC"]
	if !ok {
		t.Fatalf("BTC ausente de la respuesta: %s", env.Data)
	}
	if len(btc.Sparkline7d) != 3 {
		t.Errorf("sparkline_7d = %v, se esperaban 3 puntos", btc.Sparkline7d)
	}
	if btc.High24h != 66000 || btc.Low24h != 64000 {
		t.Errorf("high_24h=%v low_24h=%v, se esperaba 66000/64000 reales", btc.High24h, btc.Low24h)
	}
}
