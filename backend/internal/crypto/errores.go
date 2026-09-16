package crypto

import (
	"errors"
	"net/http"

	"github.com/kiramopay/backend/internal/transaction"
	"github.com/kiramopay/backend/pkg/response"
)

// Que sale al cliente cuando una operacion de cripto falla.
//
// Los handlers respondian err.Error() con un 400 ante cualquier fallo. Vender
// BTC en produccion devolvio asi el texto crudo de Postgres —la tabla, el CHECK
// y el SQLSTATE— porque nada distinguia un error de la base de un monto mal
// escrito. Ahora se decide por sentinela: lo que se reconoce sale con su codigo
// y un texto estable; lo que no, como 5xx, que response.Error deja completo en
// el log y reemplaza ante el cliente por un texto generico.

var (
	// ErrMontoInvalido: la cantidad pedida no se puede operar. El detalle lo
	// arma el servicio antes de tocar la base, asi que puede salir tal cual.
	ErrMontoInvalido = errors.New("invalid amount")
	// ErrPosicionNoEncontrada: la posicion de staking no existe o no es de
	// quien la pide.
	ErrPosicionNoEncontrada = errors.New("staking position not found")
	// ErrPosicionNoActiva: la posicion ya se retiro.
	ErrPosicionNoActiva = errors.New("staking position is not active")
	// ErrPosicionBloqueada: el plazo de la posicion todavia no vence. El
	// servicio le agrega la fecha.
	ErrPosicionBloqueada = errors.New("position is locked")
)

// rechazo es la respuesta a un error que se reconoce.
type rechazo struct {
	estado  int
	codigo  string
	mensaje string
}

// rechazoConocido traduce los errores que tienen respuesta propia. ok=false
// quiere decir que el error no se reconoce y su texto no debe salir.
//
// El texto que sale es el del sentinela, no err.Error(): el error llega
// envuelto en prefijos internos ("sell BTC: post ledger: ..."). Las excepciones
// son las que el servicio arma completas antes de tocar la base: el monto
// invalido y los rechazos de precio, cuyo texto trae los dos precios que la
// pantalla muestra.
func rechazoConocido(err error) (rechazo, bool) {
	switch {
	// El gate de MFA vive en transaction.CreateTransaction, asi que comprar
	// tambien puede devolverlo. Sin este codigo el cliente mostraba el mensaje
	// en ingles del servidor y nunca ofrecia el desafio.
	case errors.Is(err, transaction.ErrMFARequired):
		return rechazo{http.StatusPreconditionRequired, "MFA_REQUIRED",
			"verified MFA challenge required for this amount"}, true
	case errors.Is(err, ErrSaldoDeActivoInsuficiente):
		return rechazo{http.StatusUnprocessableEntity, "CRYPTO_INSUFFICIENT_BALANCE",
			ErrSaldoDeActivoInsuficiente.Error()}, true
	case errors.Is(err, ErrMontoInvalido):
		return rechazo{http.StatusBadRequest, "CRYPTO_INVALID_AMOUNT", err.Error()}, true
	case errors.Is(err, transaction.ErrSaldoInsuficiente):
		return rechazo{http.StatusUnprocessableEntity, "INSUFFICIENT_BALANCE",
			transaction.ErrSaldoInsuficiente.Error()}, true
	case errors.Is(err, transaction.ErrDailyLimitExceeded):
		return rechazo{http.StatusUnprocessableEntity, "DAILY_LIMIT_EXCEEDED",
			transaction.ErrDailyLimitExceeded.Error()}, true
	case errors.Is(err, transaction.ErrMonthlyLimitExceeded):
		return rechazo{http.StatusUnprocessableEntity, "MONTHLY_LIMIT_EXCEEDED",
			transaction.ErrMonthlyLimitExceeded.Error()}, true
	// La misma llave con otro monto. En la venta el monto fiat lo calcula el
	// servidor, asi que un reintento despues de que el precio se movio cae aqui.
	case errors.Is(err, transaction.ErrLlaveReutilizada):
		return rechazo{http.StatusConflict, "LLAVE_REUTILIZADA",
			transaction.ErrLlaveReutilizada.Error()}, true
	}
	if codigo, estado, ok := errorDePrecio(err); ok {
		return rechazo{estado, codigo, err.Error()}, true
	}
	return rechazo{}, false
}

// rechazosConElCodigoDeLaOperacion no tienen codigo propio: salen con el de la
// operacion y un 400, como antes, pero con el texto del sentinela.
var rechazosConElCodigoDeLaOperacion = []error{
	transaction.ErrBloqueadoPorRiesgo,
	ErrPosicionNoEncontrada,
	ErrPosicionNoActiva,
}

// responderError escribe la respuesta de error de una operacion de cripto.
// codigoDeLaOperacion es el de siempre (SELL_FAILED, BUY_FAILED...): lo llevan
// los rechazos sin codigo propio y los errores que no se reconocen.
func responderError(w http.ResponseWriter, err error, codigoDeLaOperacion string) {
	estado, codigo, mensaje := respuestaDeError(err, codigoDeLaOperacion)
	response.Error(w, estado, codigo, mensaje)
}

func respuestaDeError(err error, codigoDeLaOperacion string) (int, string, string) {
	if r, ok := rechazoConocido(err); ok {
		return r.estado, r.codigo, r.mensaje
	}
	// El plazo sale con su fecha, que la arma el servicio.
	if errors.Is(err, ErrPosicionBloqueada) {
		return http.StatusBadRequest, codigoDeLaOperacion, err.Error()
	}
	for _, sentinela := range rechazosConElCodigoDeLaOperacion {
		if errors.Is(err, sentinela) {
			return http.StatusBadRequest, codigoDeLaOperacion, sentinela.Error()
		}
	}
	// Cualquier otro: la base, el libro, la red. Se manda el detalle completo
	// para que quede en el log; response.Error no lo deja salir en un 5xx.
	return http.StatusInternalServerError, codigoDeLaOperacion, err.Error()
}
