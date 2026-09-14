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
	ErrPrecioMovido = errors.New("el precio cambio desde que se mostro")
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
	usd, err := s.precioEnDolares(ctx, asset)
	if err != nil {
		return decimal.Zero, err
	}
	return s.convertirDesdeDolares(ctx, usd, currency)
}

// precioEnDolares es el precio del feed, que cotiza en dolares. Es tambien el
// unico precio que la pantalla le muestra a la persona.
func (s *Service) precioEnDolares(ctx context.Context, asset string) (decimal.Decimal, error) {
	usd, err := s.prices.GetPrice(ctx, asset)
	// Un precio vencido no es "no hay precio": el sistema si tiene un numero,
	// pero esta muerto. Se propaga tal cual para que el cliente reciba su
	// propio codigo y el log distinga un proveedor caido de un activo que no
	// cotiza.
	if errors.Is(err, ErrPrecioViejo) {
		return decimal.Zero, err
	}
	if err != nil || usd <= 0 {
		return decimal.Zero, fmt.Errorf("%w: %s", ErrSinPrecio, asset)
	}
	return decimal.NewFromFloat(usd), nil
}

// precioParaLiquidar compara el precio que la persona vio contra el del
// servidor y devuelve el precio de una unidad en la moneda en que se liquida.
//
// La comparacion va en DOLARES, la moneda en que la pantalla muestra el
// precio, sin importar en que moneda se pague o se cobre. Antes se comparaba
// lo visto (dolares) contra el precio ya convertido a colones: 77.294 contra
// 34.777.662 es una desviacion del 99,98 %, asi que vender cripto para recibir
// colones —la opcion que la pantalla trae marcada— se rechazaba SIEMPRE con
// PRICE_MOVED. La liquidacion si va en la moneda pedida, con el tipo de cambio
// del sistema.
//
// La moneda y el tipo de cambio se resuelven primero: si no se puede liquidar,
// ese es el motivo que importa, no la desviacion.
func (s *Service) precioParaLiquidar(ctx context.Context, usd, visto decimal.Decimal, currency string) (decimal.Decimal, error) {
	precio, err := s.convertirDesdeDolares(ctx, usd, currency)
	if err != nil {
		return decimal.Zero, err
	}
	if err := comprobarDesviacion(visto, usd); err != nil {
		return decimal.Zero, err
	}
	return precio, nil
}

// convertirDesdeDolares pasa el precio del feed a la moneda del monedero.
func (s *Service) convertirDesdeDolares(ctx context.Context, precio decimal.Decimal, currency string) (decimal.Decimal, error) {
	switch currency {
	case "USD":
		return precio, nil
	case "CRC":
		if s.rates == nil {
			return decimal.Zero, fmt.Errorf("%w: %s", ErrSinPrecio, currency)
		}
		tipo, err := s.rates(ctx, "USD", "CRC")
		// Un tipo de cambio sin confirmar es un precio viejo, no la falta de
		// uno: se propaga con su propio codigo para que la pantalla y el log
		// distingan una fuente caida de un par que no existe.
		if errors.Is(err, ErrPrecioViejo) {
			return decimal.Zero, err
		}
		if err != nil || tipo <= 0 {
			return decimal.Zero, fmt.Errorf("%w: USD/CRC", ErrSinPrecio)
		}
		return precio.Mul(decimal.NewFromFloat(tipo)), nil
	default:
		return decimal.Zero, fmt.Errorf("%w: %s", ErrMonedaNoSoportada, currency)
	}
}

// comprobarDesviacion compara el precio que el cliente dice haber visto contra
// el que manda el servidor, los dos en dolares. Cero o negativo significa que
// el cliente no mando ninguno, y entonces no hay nada que comparar: el precio
// del servidor rige igual, esto solo protege a la persona de una sorpresa.
func comprobarDesviacion(visto, actualUSD decimal.Decimal) error {
	if !visto.IsPositive() || !actualUSD.IsPositive() {
		return nil
	}
	desvio := visto.Sub(actualUSD).Abs().Div(actualUSD)
	if desvio.GreaterThan(decimal.NewFromFloat(desviacionMaxima)) {
		return fmt.Errorf("%w: en pantalla %s USD, ahora %s USD", ErrPrecioMovido,
			visto.StringFixed(2), actualUSD.StringFixed(2))
	}
	return nil
}
