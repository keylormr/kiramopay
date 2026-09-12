package escrow

import (
	"testing"
	"time"
)

// Los avisos escriben el monto como la app: simbolo y miles con coma, que es
// la regla del dueno para todos los montos.
func TestMontoLegible(t *testing.T) {
	casos := map[string]struct {
		minor  int64
		moneda string
	}{
		"₡12,500.00":    {1_250_000, "CRC"},
		"₡1,234,567.89": {123_456_789, "CRC"},
		"₡0.99":         {99, "CRC"},
		"$25.00":        {2_500, "USD"},
		"$1,000.00":     {100_000, "USD"},
		"EUR 10.50":     {1_050, "EUR"},
		"-₡5.00":        {-500, "CRC"},
	}
	for want, c := range casos {
		if got := montoLegible(c.minor, c.moneda); got != want {
			t.Errorf("montoLegible(%d, %s) = %q, se esperaba %q", c.minor, c.moneda, got, want)
		}
	}
}

// La fecha del aviso va en hora de Costa Rica, no en la del servidor.
func TestFechaLegibleEnHoraDeCostaRica(t *testing.T) {
	utc := time.Date(2026, 9, 20, 3, 30, 0, 0, time.UTC) // 21:30 del 19 en CR
	if got := fechaLegible(&utc); got != "19/09/2026 a las 21:30" {
		t.Fatalf("fechaLegible = %q", got)
	}
	if got := fechaLegible(nil); got == "" {
		t.Fatal("sin fecha tiene que decirlo, no quedar vacio")
	}
}

// Un plazo en cero venceria el acuerdo en el mismo barrido que lo ve fondeado.
func TestPlazosSinValorUsanLosDeDefecto(t *testing.T) {
	p := plazosDe(&Plazos{DiasParaEntregar: 0, DiasParaRevisar: -3})
	d := PlazosPorDefecto()
	if p.DiasParaEntregar != d.DiasParaEntregar || p.DiasParaRevisar != d.DiasParaRevisar || p.AvisoAntes != d.AvisoAntes {
		t.Fatalf("plazos = %+v, se esperaban los de defecto %+v", p, d)
	}
	if got := plazosDe(nil); got != d {
		t.Fatalf("sin plazos = %+v, se esperaban %+v", got, d)
	}
	if got := plazosDe(&Plazos{DiasParaEntregar: 30}); got.DiasParaEntregar != 30 || got.DiasParaRevisar != d.DiasParaRevisar {
		t.Fatalf("un plazo configurado se perdio: %+v", got)
	}
}
