package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"

	"github.com/shopspring/decimal"

	"github.com/kiramopay/backend/internal/country"
	"github.com/kiramopay/backend/internal/crypto"
	"github.com/kiramopay/backend/internal/lightning"
	"github.com/kiramopay/backend/internal/qrpayment"
)

// dominiosLightning son los dominios de direcciones Lightning con los que el
// servidor habla. Por defecto, el de Breez; cuando el dueno apunte
// pay.kiramopay.com a breez.tips, se agrega en LIGHTNING_DOMINIOS (separados
// por coma).
func dominiosLightning() []string {
	valor := strings.TrimSpace(os.Getenv("LIGHTNING_DOMINIOS"))
	if valor == "" {
		return []string{"breez.tips"}
	}
	var dominios []string
	for _, d := range strings.Split(valor, ",") {
		if d = strings.TrimSpace(d); d != "" {
			dominios = append(dominios, d)
		}
	}
	return dominios
}

// precioDelBitcoin y tipoDeCambio son lo que el cotizador necesita del precio
// de cripto y del tipo de cambio; funciones para poder probarlo sin la base.
type precioDelBitcoin func(ctx context.Context, simbolo string) (float64, error)
type tipoDeCambio func(ctx context.Context, desde, hacia string) (float64, error)

// cotizadorLightning da el precio de un bitcoin en la moneda del cobro con los
// mismos numeros que cripto: el precio del feed en dolares (con su tope de
// edad) y, para colones, el tipo de cambio del BCCR que ya usa la aplicacion
// (con su tope de 96 h). Sin cualquiera de los dos no se cotiza.
func cotizadorLightning(precio precioDelBitcoin, cambio tipoDeCambio) func(context.Context, string) (qrpayment.Cotizacion, error) {
	return func(ctx context.Context, moneda string) (qrpayment.Cotizacion, error) {
		usd, err := precio(ctx, "BTC")
		if errors.Is(err, crypto.ErrPrecioViejo) {
			return qrpayment.Cotizacion{}, fmt.Errorf("%w: %v", qrpayment.ErrPrecioLightningViejo, err)
		}
		if err != nil || usd <= 0 {
			return qrpayment.Cotizacion{}, fmt.Errorf("%w: BTC/USD: %v", qrpayment.ErrPrecioLightning, err)
		}
		btcUSD := decimal.NewFromFloat(usd)
		switch moneda {
		case "USD":
			return qrpayment.Cotizacion{PrecioBTC: btcUSD, BTCUSD: btcUSD}, nil
		case "CRC":
			tasa, err := cambio(ctx, "USD", "CRC")
			if errors.Is(err, country.ErrTipoDeCambioViejo) {
				return qrpayment.Cotizacion{}, fmt.Errorf("%w: %v", qrpayment.ErrPrecioLightningViejo, err)
			}
			if err != nil || tasa <= 0 {
				return qrpayment.Cotizacion{}, fmt.Errorf("%w: USD/CRC: %v", qrpayment.ErrPrecioLightning, err)
			}
			t := decimal.NewFromFloat(tasa)
			return qrpayment.Cotizacion{PrecioBTC: btcUSD.Mul(t), BTCUSD: btcUSD, TasaUSD: t}, nil
		}
		return qrpayment.Cotizacion{}, fmt.Errorf("%w: moneda %s", qrpayment.ErrPrecioLightning, moneda)
	}
}

// opcionesLightning arma el cobro con Lightning. En produccion espera el
// criterio del abogado hasta COBRO_LIGHTNING=abierto; las cuentas de
// demostracion lo ven siempre.
func opcionesLightning(produccion bool, precio precioDelBitcoin, cambio tipoDeCambio) *qrpayment.OpcionesLightning {
	return &qrpayment.OpcionesLightning{
		Proveedor: lightning.NuevoCliente(dominiosLightning(), "bc", nil),
		Cotizar:   cotizadorLightning(precio, cambio),
		EnEspera:  produccion && os.Getenv("COBRO_LIGHTNING") != "abierto",
	}
}
