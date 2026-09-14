package crypto

import (
	"context"
	"errors"
	"fmt"
	"testing"

	"github.com/shopspring/decimal"
)

// Estas pruebas no pasan por el feed: reciben el precio en dolares ya resuelto,
// para examinar solo en que moneda se compara y en cual se liquida.

func tipoDeCambioFijo(tipo float64) RateLookup {
	return func(context.Context, string, string) (float64, error) { return tipo, nil }
}

var btcUSD = decimal.NewFromInt(77294)

// El defecto: vender a colones comparaba el precio que mostro la pantalla
// (dolares) contra el precio ya convertido a colones, y se rechazaba siempre.
func TestPrecioParaLiquidar_ComparaEnDolaresYLiquidaEnLaMonedaPedida(t *testing.T) {
	ctx := context.Background()
	s := &Service{rates: tipoDeCambioFijo(450)}
	enColones := btcUSD.Mul(decimal.NewFromInt(450))

	casos := []struct {
		nombre string
		visto  decimal.Decimal
		moneda string
		quiere decimal.Decimal
	}{
		{"colones, precio sin mover", btcUSD, "CRC", enColones},
		{"dolares, precio sin mover", btcUSD, "USD", btcUSD},
		{"colones, se movio menos que la tolerancia", decimal.NewFromInt(78000), "CRC", enColones},
		{"dolares, se movio menos que la tolerancia", decimal.NewFromInt(76500), "USD", btcUSD},
		{"sin precio visto no hay nada que comparar", decimal.Zero, "CRC", enColones},
	}
	for _, c := range casos {
		precio, err := s.precioParaLiquidar(ctx, btcUSD, c.visto, c.moneda)
		if err != nil {
			t.Fatalf("%s: %v", c.nombre, err)
		}
		if !precio.Equal(c.quiere) {
			t.Fatalf("%s: se liquida a %s, se esperaba %s", c.nombre, precio, c.quiere)
		}
	}
}

func TestPrecioParaLiquidar_UnPrecioMovidoSeRechazaEnLasDosMonedas(t *testing.T) {
	ctx := context.Background()
	s := &Service{rates: tipoDeCambioFijo(450)}
	movido := btcUSD.Mul(decimal.RequireFromString("1.03")) // 3 %, pasa el 2 % tolerado

	for _, moneda := range []string{"CRC", "USD"} {
		if _, err := s.precioParaLiquidar(ctx, btcUSD, movido, moneda); !errors.Is(err, ErrPrecioMovido) {
			t.Fatalf("%s con el precio movido 3 %%: err = %v, se esperaba ErrPrecioMovido", moneda, err)
		}
	}

	// El precio ya convertido a colones no es lo que muestra la pantalla: el
	// contrato es el precio en dolares, y comparado en dolares queda lejisimos.
	if _, err := s.precioParaLiquidar(ctx, btcUSD, btcUSD.Mul(decimal.NewFromInt(450)), "CRC"); !errors.Is(err, ErrPrecioMovido) {
		t.Fatalf("un precio en colones como si fuera el visto: err = %v, se esperaba ErrPrecioMovido", err)
	}
}

// Si no se puede liquidar, ese es el motivo que llega, no la desviacion.
func TestPrecioParaLiquidar_LaMonedaYElTipoDeCambioVanPrimero(t *testing.T) {
	ctx := context.Background()
	s := &Service{rates: tipoDeCambioFijo(450)}
	if _, err := s.precioParaLiquidar(ctx, btcUSD, decimal.NewFromInt(1), "EUR"); !errors.Is(err, ErrMonedaNoSoportada) {
		t.Fatalf("moneda no soportada: err = %v, se esperaba ErrMonedaNoSoportada", err)
	}

	viejo := &Service{rates: func(context.Context, string, string) (float64, error) {
		return 0, fmt.Errorf("%w: USD/CRC sin confirmar", ErrPrecioViejo)
	}}
	if _, err := viejo.precioParaLiquidar(ctx, btcUSD, btcUSD, "CRC"); !errors.Is(err, ErrPrecioViejo) {
		t.Fatalf("tipo de cambio viejo en colones: err = %v, se esperaba ErrPrecioViejo", err)
	}
	// En dolares no hace falta tipo de cambio.
	if _, err := viejo.precioParaLiquidar(ctx, btcUSD, btcUSD, "USD"); err != nil {
		t.Fatalf("en dolares no depende del tipo de cambio: %v", err)
	}
}
