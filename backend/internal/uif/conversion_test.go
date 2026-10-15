package uif

import "testing"

// Los centimos y los centavos son centesimas: convertir es dividir por el tipo
// de cambio y redondear al centavo.
func TestEnCentavosDeDolar(t *testing.T) {
	casos := []struct {
		minor    int64
		porDolar float64
		want     int64
	}{
		{500_000_000, 455.6, 1_097_454}, // ₡5.000.000 = US$10.974,54
		{550_000_000, 550, 1_000_000},   // ₡5.500.000 a 550 = US$10.000
		{950_000, 0.92, 1_032_609},      // €9.500 = US$10.326,09
		{1_000, 1, 1_000},
		{0, 455.6, 0},
	}
	for _, c := range casos {
		if got := enCentavosDeDolar(c.minor, c.porDolar); got != c.want {
			t.Errorf("enCentavosDeDolar(%d, %v) = %d, se esperaba %d", c.minor, c.porDolar, got, c.want)
		}
	}
}
