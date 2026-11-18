package main

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"testing"

	"github.com/shopspring/decimal"

	"github.com/kiramopay/backend/internal/country"
	"github.com/kiramopay/backend/internal/crypto"
	"github.com/kiramopay/backend/internal/qrpayment"
)

func precioFijo(usd float64, err error) precioDelBitcoin {
	return func(context.Context, string) (float64, error) { return usd, err }
}

func cambioFijo(tasa float64, err error) tipoDeCambio {
	return func(context.Context, string, string) (float64, error) { return tasa, err }
}

func TestCotizadorLightning_ColonesYDolares(t *testing.T) {
	cot := cotizadorLightning(precioFijo(80_000, nil), cambioFijo(500, nil))

	crc, err := cot(context.Background(), "CRC")
	if err != nil {
		t.Fatal(err)
	}
	if !crc.PrecioBTC.Equal(decimal.NewFromInt(40_000_000)) || !crc.BTCUSD.Equal(decimal.NewFromInt(80_000)) ||
		!crc.TasaUSD.Equal(decimal.NewFromInt(500)) {
		t.Fatalf("colones: %+v", crc)
	}
	usd, err := cot(context.Background(), "USD")
	if err != nil {
		t.Fatal(err)
	}
	if !usd.PrecioBTC.Equal(decimal.NewFromInt(80_000)) || !usd.TasaUSD.IsZero() {
		t.Fatalf("dolares: %+v", usd)
	}
}

// Sin precio o con uno que no se confirmo, no se cotiza; y cada caso con su
// motivo, para que la pantalla distinga una fuente caida de una vieja.
func TestCotizadorLightning_SinNumerosNoCotiza(t *testing.T) {
	casos := []struct {
		nombre string
		precio precioDelBitcoin
		cambio tipoDeCambio
		moneda string
		quiero error
	}{
		{"precio viejo", precioFijo(0, fmt.Errorf("x: %w", crypto.ErrPrecioViejo)), cambioFijo(500, nil), "CRC", qrpayment.ErrPrecioLightningViejo},
		{"sin precio", precioFijo(0, errors.New("caido")), cambioFijo(500, nil), "CRC", qrpayment.ErrPrecioLightning},
		{"precio cero", precioFijo(0, nil), cambioFijo(500, nil), "USD", qrpayment.ErrPrecioLightning},
		{"tipo de cambio viejo", precioFijo(80_000, nil), cambioFijo(0, fmt.Errorf("x: %w", country.ErrTipoDeCambioViejo)), "CRC", qrpayment.ErrPrecioLightningViejo},
		{"sin tipo de cambio", precioFijo(80_000, nil), cambioFijo(0, errors.New("sin fila")), "CRC", qrpayment.ErrPrecioLightning},
		{"otra moneda", precioFijo(80_000, nil), cambioFijo(500, nil), "EUR", qrpayment.ErrPrecioLightning},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			if _, err := cotizadorLightning(c.precio, c.cambio)(context.Background(), c.moneda); !errors.Is(err, c.quiero) {
				t.Fatalf("error %v, quiero %v", err, c.quiero)
			}
		})
	}
}

func TestDominiosLightning(t *testing.T) {
	t.Setenv("LIGHTNING_DOMINIOS", "")
	if got := dominiosLightning(); !reflect.DeepEqual(got, []string{"breez.tips"}) {
		t.Fatalf("por defecto %v", got)
	}
	t.Setenv("LIGHTNING_DOMINIOS", " breez.tips , pay.kiramopay.com,,")
	if got := dominiosLightning(); !reflect.DeepEqual(got, []string{"breez.tips", "pay.kiramopay.com"}) {
		t.Fatalf("con la variable %v", got)
	}
}

func TestOpcionesLightning_EsperanEnProduccion(t *testing.T) {
	t.Setenv("COBRO_LIGHTNING", "")
	if !opcionesLightning(true, precioFijo(1, nil), cambioFijo(1, nil)).EnEspera {
		t.Fatal("en produccion sin la variable no espera")
	}
	if opcionesLightning(false, precioFijo(1, nil), cambioFijo(1, nil)).EnEspera {
		t.Fatal("fuera de produccion espera")
	}
	t.Setenv("COBRO_LIGHTNING", "abierto")
	if opcionesLightning(true, precioFijo(1, nil), cambioFijo(1, nil)).EnEspera {
		t.Fatal("con COBRO_LIGHTNING=abierto sigue esperando")
	}
}
