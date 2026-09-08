package uif_test

import (
	"testing"

	"github.com/kiramopay/backend/internal/kyc"
	"github.com/kiramopay/backend/internal/uif"
)

// El diagnostico tiene que decir la verdad en los dos sentidos: marcar
// inalcanzable cuando el tope corta antes del umbral, y alcanzable cuando no.
// Si solo probara el caso de hoy, el dia que alguien suba los topes nadie sabria
// si el detector sigue sirviendo.
func TestDiagnostico(t *testing.T) {
	umbrales := uif.Thresholds{Daily: map[string]int64{"CRC": 1000, "USD": 1000}}

	d := uif.Diagnostico(umbrales, map[string]int64{"CRC": 999, "USD": 1000})
	if len(d) != 2 {
		t.Fatalf("esperaba dos monedas, hubo %d", len(d))
	}
	for _, a := range d {
		if a.Alcanzable {
			t.Fatalf("%s: un tope que no SUPERA el umbral no puede cruzarlo", a.Moneda)
		}
	}

	d = uif.Diagnostico(umbrales, map[string]int64{"CRC": 1001, "USD": 5000})
	for _, a := range d {
		if !a.Alcanzable {
			t.Fatalf("%s: con el tope por encima del umbral si se puede cruzar", a.Moneda)
		}
	}
}

// Y el hecho que hay que tener delante: HOY, con los umbrales por defecto y los
// topes de KYC de la aplicacion, la cola de cumplimiento no puede recibir un
// solo caso.
//
// Esta prueba no dice que eso este mal —es la consecuencia de tener topes
// bajos, y mover el umbral es una decision regulatoria, no tecnica—. Dice que el
// hecho es conocido. El dia que alguien cambie cualquiera de los dos numeros,
// esta prueba se cae y obliga a mirar el otro.
func TestHoyElUmbralEsInalcanzable(t *testing.T) {
	max := kyc.LevelLimits[kyc.LevelComplete]
	d := uif.Diagnostico(uif.DefaultThresholds(), map[string]int64{
		"CRC": max.DailyMinor,
		"USD": max.DailyMinorUSD,
	})
	for _, a := range d {
		if a.Alcanzable {
			t.Fatalf("%s cambio: %s.\n"+
				"Si ahora SI se puede alcanzar el umbral, esta prueba sobra y hay que "+
				"borrarla; si el cambio fue accidental, revisar el otro numero.", a.Moneda, a)
		}
	}
}
