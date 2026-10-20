package uif

import "testing"

// El umbral es uno solo y en dolares: la ley fija US$10.000 o su equivalente en
// otras monedas. Cada regla compara el equivalente en centavos de dolar; el
// servicio convierte con el tipo de cambio oficial antes de evaluar.
func TestThresholds_Evaluate(t *testing.T) {
	th := DefaultThresholds() // US$10.000 = 1_000_000 centavos
	cases := []struct {
		name       string
		amount     int64
		priorDaily int64
		wantReport bool
		wantType   string
	}{
		{"single at threshold", 1_000_000, 0, true, TypeSingleThreshold},
		{"single above threshold", 1_500_000, 0, true, TypeSingleThreshold},
		{"single below threshold", 999_999, 0, false, ""},
		{"structuring crosses with this tx", 400_000, 700_000, true, TypeStructuring},
		{"structuring exactly crosses", 1, 999_999, true, TypeStructuring},
		{"below even with prior", 100_000, 200_000, false, ""},
		{"already above daily — no duplicate", 100_000, 1_000_000, false, ""},
		{"single takes precedence over structuring", 1_200_000, 900_000, true, TypeSingleThreshold},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := th.Evaluate(c.amount, c.priorDaily)
			if got.Reportable != c.wantReport {
				t.Fatalf("Reportable = %v, want %v (reason: %q)", got.Reportable, c.wantReport, got.Reason)
			}
			if c.wantReport && got.Type != c.wantType {
				t.Fatalf("Type = %q, want %q", got.Type, c.wantType)
			}
			if c.wantReport && got.Reason == "" {
				t.Fatal("reportable result must carry a reason")
			}
		})
	}
}

// Las cuatro reglas usan el MISMO numero legal; lo que cambia es la ventana.
func TestElUmbralEsElMismoEnLasCuatroReglas(t *testing.T) {
	th := DefaultThresholds()
	if th.SingleUSD != 1_000_000 || th.DailyUSD != 1_000_000 || th.MensualUSD != 1_000_000 ||
		th.Acumulado30USD != 1_000_000 {
		t.Fatalf("umbrales = %+v, se esperaba US$10.000 (1_000_000 centavos) en las cuatro reglas", th)
	}
}
