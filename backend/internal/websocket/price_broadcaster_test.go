package websocket

import (
	"testing"

	"github.com/kiramopay/backend/internal/crypto"
)

// El sparkline de 7 dias solo cambia cada ~6 horas en el origen (ver el
// comentario de sinSparkline): mandarlo en cada tick del WebSocket (5-15s)
// no trae un dato mas fresco, solo infla el mensaje. Esta prueba fija que
// sinSparkline lo quita sin tocar el resto de los campos ni mutar el precio
// que sigue viviendo en la cache del PriceService.
func TestSinSparkline_QuitaElHistorialSinTocarElResto(t *testing.T) {
	original := &crypto.PriceData{
		Symbol:      "BTC",
		Price:       65000,
		Change24h:   1.5,
		Volume24h:   2_000_000,
		MarketCap:   3_000_000,
		High24h:     66000,
		Low24h:      64000,
		Sparkline7d: []float64{64000, 64500, 65000},
	}
	entrada := map[string]*crypto.PriceData{"BTC": original}

	salida := sinSparkline(entrada)

	btc, ok := salida["BTC"]
	if !ok {
		t.Fatalf("BTC ausente del resultado: %v", salida)
	}
	if btc.Sparkline7d != nil {
		t.Errorf("Sparkline7d = %v, se esperaba nil", btc.Sparkline7d)
	}
	if btc.Price != 65000 || btc.High24h != 66000 || btc.Low24h != 64000 {
		t.Errorf("sinSparkline toco otros campos: %+v", btc)
	}

	// La copia debe ser un *crypto.PriceData distinto: si compartiera el
	// puntero, borrar el sparkline aca tambien lo borraria en la cache viva
	// del PriceService (el mismo *PriceData que GetPrices devuelve a REST).
	if btc == original {
		t.Fatal("sinSparkline devolvio el mismo puntero que la cache, no una copia")
	}
	if original.Sparkline7d == nil {
		t.Fatal("sinSparkline mutó el original: la cache del PriceService perdió su sparkline")
	}
}

// Un mapa con una entrada nil (no deberia pasar en la practica, pero
// copiaDeCache y fetchFromAPI no lo garantizan por contrato) no debe hacer
// panic: se descarta en vez de deref-erenciar un puntero nulo.
func TestSinSparkline_EntradaNilNoPanica(t *testing.T) {
	entrada := map[string]*crypto.PriceData{
		"BTC": nil,
		"ETH": {Symbol: "ETH", Price: 2500, Sparkline7d: []float64{2400, 2450, 2500}},
	}

	salida := sinSparkline(entrada)

	if _, ok := salida["BTC"]; ok {
		t.Errorf("BTC nil no deberia aparecer en el resultado: %v", salida)
	}
	eth, ok := salida["ETH"]
	if !ok || eth.Sparkline7d != nil {
		t.Errorf("ETH = %v, se esperaba presente y sin sparkline", eth)
	}
}

// Un mapa vacio no debe devolver nil: el mensaje serializa Prices como
// objeto JSON `{}`, no como `null`, para que el cliente no tenga que manejar
// dos formas distintas de "no hay precios".
func TestSinSparkline_MapaVacioDevuelveMapaVacio(t *testing.T) {
	salida := sinSparkline(map[string]*crypto.PriceData{})
	if salida == nil {
		t.Fatal("sinSparkline devolvio nil para un mapa vacio")
	}
	if len(salida) != 0 {
		t.Errorf("salida = %v, se esperaba vacia", salida)
	}
}
