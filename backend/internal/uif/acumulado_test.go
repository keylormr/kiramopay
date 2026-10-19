package uif

import (
	"testing"

	"github.com/kiramopay/backend/internal/kyc"
)

// El tope diario se reinicia cada dia: quien quiere mover mucho sin que se vea lo
// reparte en dias. La alerta interna de 30 dias es la que lo ve, con su tipo
// propio: el acumulado regulatorio es el mes calendario.
func TestElAcumuladoDisparaSoloAlCruzar(t *testing.T) {
	th := DefaultThresholds()
	umbral := th.Acumulado30USD
	// Por debajo, nada.
	if r := th.EvaluateAcumulado(1_000, umbral-10_000); r.Reportable {
		t.Fatal("por debajo del umbral disparo")
	}
	// Justo en el cruce, un caso.
	r := th.EvaluateAcumulado(20_000, umbral-10_000)
	if !r.Reportable || r.Type != TypeEstructuracion30 {
		t.Fatalf("en el cruce: %+v", r)
	}
	// Ya por encima, no se repite: la cola se llenaria de copias del mismo caso.
	if r := th.EvaluateAcumulado(1_000, umbral+5_000); r.Reportable {
		t.Fatal("ya por encima volvio a disparar")
	}
}

// Con el tope DIARIO del nivel mas alto el umbral legal no se alcanza nunca; con
// el MENSUAL si: las transacciones multiples del mes pueden llegar a la cola.
// Vale con cualquier tipo de cambio razonable del colon, no solo con el de hoy.
func TestLaReglaDe30DiasEsAlcanzableConElNivelMasAlto(t *testing.T) {
	th := DefaultThresholds()
	max := kyc.LevelLimits[kyc.LevelComplete]
	for _, tasa := range []float64{400, 455.6, 550, 700} {
		porDolar := map[string]float64{"CRC": tasa}
		if a := Diagnostico(th, map[string]int64{"CRC": max.DailyMinor, "USD": max.DailyMinorUSD}, porDolar); a.Alcanzable {
			t.Fatalf("con %v colones por dolar el diario es alcanzable (%s): revisar si esta regla sigue haciendo falta", tasa, a)
		}
		if a := DiagnosticoAcumulado(th, map[string]int64{"CRC": max.MonthlyMinor, "USD": max.MonthlyMinorUSD}, porDolar); !a.Alcanzable {
			t.Fatalf("con %v colones por dolar el acumulado del mes NO es alcanzable (%s): la cola seguiria vacia", tasa, a)
		}
	}
}
