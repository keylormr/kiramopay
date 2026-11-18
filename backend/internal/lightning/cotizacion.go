package lightning

import (
	"errors"

	"github.com/shopspring/decimal"
)

// ErrCotizacionInvalida: monto o precio que no permiten cotizar.
var ErrCotizacionInvalida = errors.New("no se puede cotizar ese monto")

// satsMaximos: 21 millones de bitcoin. Una cotizacion por encima es un precio
// roto, no una venta.
const satsMaximos = 21_000_000 * 100_000_000

// SatsPara convierte un monto en centimos de una moneda al numero de sats que
// cuesta, con el precio de un bitcoin en esa moneda.
//
// Se redondea hacia arriba: el comercio cobra al menos el precio de la venta,
// nunca un sat menos. La cuenta va en decimal, sin flotantes.
//
//	sats = techo(centimos / 100 / precio * 100.000.000) = techo(centimos * 1.000.000 / precio)
func SatsPara(centimos int64, precioBTC decimal.Decimal) (int64, error) {
	if centimos <= 0 || !precioBTC.IsPositive() {
		return 0, ErrCotizacionInvalida
	}
	sats := decimal.NewFromInt(centimos).Mul(decimal.NewFromInt(1_000_000)).Div(precioBTC).Ceil()
	if !sats.IsPositive() || sats.GreaterThan(decimal.NewFromInt(satsMaximos)) {
		return 0, ErrCotizacionInvalida
	}
	return sats.IntPart(), nil
}
