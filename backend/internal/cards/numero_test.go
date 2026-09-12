package cards

import (
	"strings"
	"testing"
)

// La tarjeta imprimia un numero VISA valido por Luhn, que podia ser el de una
// persona real ajena a la aplicacion.

func TestPasaLuhnReconoceTarjetasReales(t *testing.T) {
	// Numeros de prueba publicos de las redes: pasan Luhn como cualquier
	// tarjeta real. Si pasaLuhn no los reconociera, la prueba de abajo no
	// probaria nada.
	for _, real := range []string{"4111111111111111", "5555555555554444", "378282246310005"} {
		if !pasaLuhn(real) {
			t.Fatalf("%s es un numero de tarjeta valido y pasaLuhn dice que no", real)
		}
	}
	if pasaLuhn("4111111111111112") {
		t.Fatal("un digito verificador alterado no puede pasar Luhn")
	}
}

func TestElNumeroDecorativoNoPuedeSerUnaTarjeta(t *testing.T) {
	for i := 0; i < 20000; i++ {
		n := numeroDecorativo()
		if len(n) != 16 || strings.Trim(n, "0123456789") != "" {
			t.Fatalf("numero mal formado: %q", n)
		}
		if !strings.HasPrefix(n, prefijoDecorativo) {
			t.Fatalf("%s no empieza en %s", n, prefijoDecorativo)
		}
		if pasaLuhn(n) {
			t.Fatalf("%s pasa Luhn: podria ser la tarjeta de alguien", n)
		}
	}
}
