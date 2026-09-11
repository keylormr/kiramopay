package uif

import (
	"testing"

	"github.com/kiramopay/backend/internal/kyc"
)

// El tope diario se reinicia cada dia: quien quiere mover mucho sin que se vea lo
// reparte en dias. La regla de 30 dias es la que lo ve.

func TestElAcumuladoDisparaSoloAlCruzar(t *testing.T) {
	th := DefaultThresholds()
	umbral := th.Acumulado30["CRC"]

	// Por debajo, nada.
	if r := th.EvaluateAcumulado("CRC", 1_000, umbral-10_000); r.Reportable {
		t.Fatal("por debajo del umbral disparo")
	}
	// Justo en el cruce, un caso.
	r := th.EvaluateAcumulado("CRC", 20_000, umbral-10_000)
	if !r.Reportable || r.Type != TypeAcumulado30 {
		t.Fatalf("en el cruce: %+v", r)
	}
	// Ya por encima, no se repite: la cola se llenaria de copias del mismo caso.
	if r := th.EvaluateAcumulado("CRC", 1_000, umbral+5_000); r.Reportable {
		t.Fatal("ya por encima volvio a disparar")
	}
	// Una moneda sin umbral no dispara.
	if r := th.EvaluateAcumulado("EUR", 1_000_000_000, 0); r.Reportable {
		t.Fatal("una moneda sin umbral disparo")
	}
}

// Con el tope DIARIO del nivel mas alto el umbral legal no se alcanza nunca; con
// el MENSUAL si. Esa es la razon de ser de la regla de 30 dias.
func TestLaReglaDe30DiasEsAlcanzableConElNivelMasAlto(t *testing.T) {
	th := DefaultThresholds()
	max := kyc.LevelLimits[kyc.LevelComplete]

	for _, a := range Diagnostico(th, map[string]int64{"CRC": max.DailyMinor, "USD": max.DailyMinorUSD}) {
		if a.Alcanzable {
			t.Fatalf("el diario de %s ahora es alcanzable: revisar si esta regla sigue haciendo falta", a.Moneda)
		}
	}
	vistas := 0
	for _, a := range DiagnosticoAcumulado(th, map[string]int64{"CRC": max.MonthlyMinor, "USD": max.MonthlyMinorUSD}) {
		vistas++
		if !a.Alcanzable {
			t.Fatalf("el acumulado de 30 dias de %s NO es alcanzable con el tope mensual: la cola seguiria vacia", a.Moneda)
		}
	}
	if vistas != 2 {
		t.Fatalf("se diagnosticaron %d monedas, se esperaban CRC y USD", vistas)
	}
}
