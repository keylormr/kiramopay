package uif_test

import (
	"testing"

	"github.com/kiramopay/backend/internal/kyc"
	"github.com/kiramopay/backend/internal/uif"
)

// El diagnostico tiene que decir la verdad en los dos sentidos: marcar
// inalcanzable cuando los topes cortan antes del umbral, y alcanzable cuando no.
// Si solo probara el caso de hoy, el dia que alguien suba los topes nadie sabria
// si el detector sigue sirviendo.
//
// El agregado del dia junta todas las monedas por su equivalente en dolares, asi
// que lo que se compara con el umbral es la SUMA de los topes de cada moneda.
func TestDiagnostico(t *testing.T) {
	umbrales := uif.Thresholds{DailyUSD: 1000}
	porDolar := map[string]float64{"CRC": 500}

	// 250_000 centimos a 500 por dolar = 500 centavos; mas 500 = 1000: los topes
	// dejan llegar justo al umbral (el tope rechaza solo lo que lo PASA), y la
	// regla del dia dispara al llegar (>=). El diagnostico decia INALCANZABLE.
	if a := uif.Diagnostico(umbrales, map[string]int64{"CRC": 250_000, "USD": 500}, porDolar); !a.Alcanzable {
		t.Fatalf("un tope que llega justo al umbral lo alcanza: %s", a)
	}
	// Un centavo menos ya no llega.
	if a := uif.Diagnostico(umbrales, map[string]int64{"CRC": 250_000, "USD": 499}, porDolar); a.Alcanzable {
		t.Fatalf("un tope que no llega al umbral no puede cruzarlo: %s", a)
	}
	// Ninguna moneda sola llega; juntas si.
	a := uif.Diagnostico(umbrales, map[string]int64{"CRC": 300_000, "USD": 600}, porDolar)
	if !a.Alcanzable {
		t.Fatalf("600 + 600 centavos superan el umbral de 1000: %s", a)
	}
	if a.MaximoUSDMinor != 1200 {
		t.Fatalf("maximo = %d, se esperaba 1200", a.MaximoUSDMinor)
	}
	// Una moneda sin tipo de cambio no se suma en silencio: se nombra.
	a = uif.Diagnostico(umbrales, map[string]int64{"CRC": 300_000, "USD": 600}, map[string]float64{})
	if len(a.SinTipoDeCambio) != 1 || a.SinTipoDeCambio[0] != "CRC" {
		t.Fatalf("sin tipo de cambio para el colon: %+v", a)
	}
}

// Y el hecho que hay que tener delante: HOY, con el umbral por defecto y los
// topes de KYC de la aplicacion, ni sumando las dos monedas un dia llega al
// umbral (₡2.000.000 + US$3.800 dan unos US$8.200 con el colon a 455,6).
//
// Esta prueba no dice que eso este mal —es la consecuencia de tener topes
// bajos, y mover el umbral es una decision regulatoria, no tecnica—. Dice que el
// hecho es conocido. El dia que alguien cambie cualquiera de los dos numeros,
// esta prueba se cae y obliga a mirar el otro.
func TestHoyElUmbralEsInalcanzable(t *testing.T) {
	max := kyc.LevelLimits[kyc.LevelComplete]
	a := uif.Diagnostico(uif.DefaultThresholds(), map[string]int64{
		"CRC": max.DailyMinor,
		"USD": max.DailyMinorUSD,
	}, map[string]float64{"CRC": 455.6})
	if a.Alcanzable {
		t.Fatalf("cambio: %s.\n"+
			"Si ahora SI se puede alcanzar el umbral, esta prueba sobra y hay que "+
			"borrarla; si el cambio fue accidental, revisar el otro numero.", a)
	}
}
