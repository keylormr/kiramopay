package crypto

import (
	"context"
	"errors"
	"fmt"

	"github.com/shopspring/decimal"
)

// El precio lo pone el servidor, nunca el cliente.
//
// Buy, Sell y Convert recibian del cliente la cantidad de cripto, el precio Y
// el monto fiat, y los aplicaban tal cual: nadie comprobaba que guardaran
// relacion con el mercado. Con eso, dos peticiones autenticadas normales creaban
// dinero de la nada — pedir "debitame 1 colon y acreditame 1000 BTC", y despues
// vender esos 1000 BTC por el fiat que uno quisiera. El credito de la venta
// entraba ademas por un tipo ENTRANTE, que no pasa por saldo, ni limite diario,
// ni MFA.
//
// Ahora el cliente solo dice cuanto de LO SUYO quiere mover: cuanta plata gastar
// al comprar, cuanto cripto vender. La otra mitad la calcula el servidor con su
// propio precio. Si no tiene precio, no hay operacion: cotizar sin precio es
// justamente lo que se esta corrigiendo.

var (
	// ErrSinPrecio: no se pudo saber cuanto vale el activo. Sin eso no se opera.
	ErrSinPrecio = errors.New("no market price available for this asset")
	// ErrPrecioMovido: el precio que el cliente vio quedo lejos del actual. Se
	// rechaza en vez de ejecutar a un precio que la persona no acepto.
	ErrPrecioMovido = errors.New("price moved since it was quoted")
	// ErrMonedaNoSoportada: solo se cotiza contra las monedas del monedero.
	ErrMonedaNoSoportada = errors.New("unsupported fiat currency")
)

// desviacionMaxima es cuanto puede haberse movido el precio entre que la
// pantalla lo mostro y que llega la peticion, antes de rechazar. Dos por ciento
// tolera el vaiven normal de un mercado de cripto en unos segundos y frena una
// peticion armada a mano con un precio inventado.
const desviacionMaxima = 0.02

// RateLookup resuelve el tipo de cambio entre dos monedas fiat. Lo aporta quien
// construye el servicio; nil deja el servicio operando solo en dolares.
type RateLookup func(ctx context.Context, from, to string) (float64, error)

// precioEn devuelve cuanto vale UNA unidad del activo, en la moneda fiat pedida.
//
// El feed cotiza en dolares, asi que para colones hace falta el tipo de cambio
// del sistema — el mismo que sirve el resto de la aplicacion, no una constante
// suelta. Si falta cualquiera de los dos, no hay precio: mejor no operar que
// operar con un numero inventado.
func (s *Service) precioEn(ctx context.Context, asset, currency string) (decimal.Decimal, error) {
	usd, err := s.prices.GetPrice(ctx, asset)
	if err != nil || usd <= 0 {
		return decimal.Zero, fmt.Errorf("%w: %s", ErrSinPrecio, asset)
	}
	precio := decimal.NewFromFloat(usd)

	switch currency {
	case "USD":
		return precio, nil
	case "CRC":
		if s.rates == nil {
			return decimal.Zero, fmt.Errorf("%w: %s", ErrSinPrecio, currency)
		}
		tipo, err := s.rates(ctx, "USD", "CRC")
		if err != nil || tipo <= 0 {
			return decimal.Zero, fmt.Errorf("%w: USD/CRC", ErrSinPrecio)
		}
		return precio.Mul(decimal.NewFromFloat(tipo)), nil
	default:
		return decimal.Zero, fmt.Errorf("%w: %s", ErrMonedaNoSoportada, currency)
	}
}

// comprobarDesviacion compara el precio que el cliente dice haber visto contra
// el que manda el servidor. Cero o negativo significa que el cliente no mando
// ninguno, y entonces no hay nada que comparar: el precio del servidor rige
// igual, esto solo protege a la persona de una sorpresa.
func comprobarDesviacion(visto, actual decimal.Decimal) error {
	if !visto.IsPositive() || !actual.IsPositive() {
		return nil
	}
	desvio := visto.Sub(actual).Abs().Div(actual)
	if desvio.GreaterThan(decimal.NewFromFloat(desviacionMaxima)) {
		return fmt.Errorf("%w: se mostro %s y ahora vale %s", ErrPrecioMovido,
			visto.StringFixed(2), actual.StringFixed(2))
	}
	return nil
}
