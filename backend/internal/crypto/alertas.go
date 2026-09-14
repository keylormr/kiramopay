package crypto

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/shopspring/decimal"
)

// Las alertas de precio aceptaban cualquier cosa.
//
// El handler pasaba el cuerpo al INSERT sin mirarlo: la unica validacion eran
// dos CHECK de la base (precio positivo y direccion). Una alerta sobre un
// activo que no existe ('NOEXISTE', o vacio) o con un precio de
// 999.999.999.999 dolares se guardaba con 201, y las que si chocaban con un
// CHECK devolvian el SQLSTATE crudo.

var (
	// ErrAlertaActivoNoSoportado: el simbolo no esta en el catalogo que cotiza
	// el sistema. Sin precio de ese activo, la alerta no se podria cumplir nunca.
	ErrAlertaActivoNoSoportado = errors.New("price alert: unsupported asset")
	// ErrAlertaDireccionInvalida: la direccion no es above ni below.
	ErrAlertaDireccionInvalida = errors.New("price alert: direction must be above or below")
	// ErrAlertaPrecioFueraDeRango: el precio objetivo no es positivo o no
	// guarda relacion con el mercado.
	ErrAlertaPrecioFueraDeRango = errors.New("price alert: target price out of range")
)

// alertaPrecioMaximoUSD es el techo fijo del precio objetivo, en dolares (la
// moneda del feed). Rige siempre, tambien cuando no hay precio de mercado con
// que comparar: ningun activo del catalogo cotiza cerca de diez millones.
var alertaPrecioMaximoUSD = decimal.NewFromInt(10_000_000)

// alertaFactorDeMercado acota el precio objetivo contra el precio actual,
// cuando se conoce: ni mas de cien veces por encima ni por debajo de la
// centesima parte. Una meta fuera de esa franja no es una alerta, es un error
// de tipeo.
var alertaFactorDeMercado = decimal.NewFromInt(100)

// validarAlerta normaliza la alerta y la rechaza si no tiene sentido.
func (s *Service) validarAlerta(ctx context.Context, a *PriceAlertRecord) error {
	a.Asset = strings.ToUpper(strings.TrimSpace(a.Asset))
	if _, ok := coinGeckoIDs[a.Asset]; !ok {
		return fmt.Errorf("%w: %q", ErrAlertaActivoNoSoportado, a.Asset)
	}
	a.Direction = strings.ToLower(strings.TrimSpace(a.Direction))
	if a.Direction != "above" && a.Direction != "below" {
		return ErrAlertaDireccionInvalida
	}
	if !a.TargetPrice.IsPositive() || a.TargetPrice.GreaterThan(alertaPrecioMaximoUSD) {
		return ErrAlertaPrecioFueraDeRango
	}
	// Contra el mercado solo si hay un precio vigente. Sin el (proveedor
	// caido, precio viejo) la alerta no se rechaza por eso: no mueve dinero, y
	// el techo fijo ya freno lo absurdo.
	if s.prices == nil {
		return nil
	}
	usd, err := s.precioEnDolares(ctx, a.Asset)
	if err != nil {
		return nil
	}
	if a.TargetPrice.GreaterThan(usd.Mul(alertaFactorDeMercado)) ||
		a.TargetPrice.LessThan(usd.Div(alertaFactorDeMercado)) {
		return ErrAlertaPrecioFueraDeRango
	}
	return nil
}

// errorDeAlerta traduce los rechazos de validarAlerta a un codigo propio, para
// que la pantalla pueda explicarlos en vez de mostrar la frase del servidor.
func errorDeAlerta(err error) (string, int, bool) {
	switch {
	case errors.Is(err, ErrAlertaActivoNoSoportado):
		return "ALERT_UNSUPPORTED_ASSET", http.StatusBadRequest, true
	case errors.Is(err, ErrAlertaDireccionInvalida):
		return "ALERT_INVALID_DIRECTION", http.StatusBadRequest, true
	case errors.Is(err, ErrAlertaPrecioFueraDeRango):
		return "ALERT_PRICE_OUT_OF_RANGE", http.StatusBadRequest, true
	}
	return "", 0, false
}
