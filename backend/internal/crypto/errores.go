package crypto

import (
	"errors"
	"net/http"

	"github.com/kiramopay/backend/internal/qrpayment"
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
	// ErrStakingNoDisponible: el activo no esta en el programa de staking.
	ErrStakingNoDisponible = errors.New("staking is not available for this asset")
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
	// Los rechazos del staking tienen codigo propio: salian los tres como
	// UNSTAKE_FAILED y la pantalla solo podia distinguirlos leyendo el texto en
	// ingles, que terminaba en pantalla tal cual.
	case errors.Is(err, ErrStakingNoDisponible):
		return rechazo{http.StatusBadRequest, "STAKING_NOT_AVAILABLE",
			ErrStakingNoDisponible.Error()}, true
	case errors.Is(err, ErrPosicionNoEncontrada):
		return rechazo{http.StatusNotFound, "STAKING_POSITION_NOT_FOUND",
			ErrPosicionNoEncontrada.Error()}, true
	case errors.Is(err, ErrPosicionNoActiva):
		return rechazo{http.StatusConflict, "STAKING_POSITION_INACTIVE",
			ErrPosicionNoActiva.Error()}, true
	// El plazo sale con su fecha, que la arma el servicio.
	case errors.Is(err, ErrPosicionBloqueada):
		return rechazo{http.StatusConflict, "STAKING_POSITION_LOCKED", err.Error()}, true

	// Los rechazos del envio entre personas. Los del QR salen con el MISMO
	// codigo que usa el pago por QR: es el mismo escaner, y dos codigos para
	// "ese codigo no sirve" serian dos mensajes distintos para lo mismo.
	case errors.Is(err, qrpayment.ErrQRInvalido):
		return rechazo{http.StatusBadRequest, "QR_INVALIDO",
			"ese codigo no existe o ya no es valido"}, true
	case errors.Is(err, qrpayment.ErrQRRevocado):
		return rechazo{http.StatusConflict, "QR_REVOCADO",
			"ese codigo fue retirado por su dueno"}, true
	case errors.Is(err, qrpayment.ErrQRDeComercio):
		return rechazo{http.StatusUnprocessableEntity, "QR_DE_COMERCIO",
			"ese codigo es de un comercio: los comercios cobran en colones o dolares"}, true
	case errors.Is(err, qrpayment.ErrQRDeCobro):
		return rechazo{http.StatusUnprocessableEntity, "QR_DE_COBRO",
			"ese codigo es un cobro en dinero: pagalo desde Pagar con QR"}, true
	case errors.Is(err, ErrNoTePodesEnviar):
		return rechazo{http.StatusBadRequest, "CRYPTO_SEND_SELF",
			ErrNoTePodesEnviar.Error()}, true
	// Mismo codigo que la llave reusada del libro: para la pantalla es el mismo
	// caso —esa llave ya se gasto en otra cosa— y se resuelve igual.
	case errors.Is(err, ErrLlaveDeOtroEnvio):
		return rechazo{http.StatusConflict, "LLAVE_REUTILIZADA",
			"esa operacion ya se hizo con otro monto o para otra persona"}, true
	// Al servicio no se le dio con que resolver un QR. No es culpa de quien
	// envia ni algo que reintentar cambie: es la aplicacion, mal armada.
	case errors.Is(err, ErrEnvioNoDisponible):
		return rechazo{http.StatusServiceUnavailable, "CRYPTO_SEND_UNAVAILABLE",
			ErrEnvioNoDisponible.Error()}, true
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
	for _, sentinela := range rechazosConElCodigoDeLaOperacion {
		if errors.Is(err, sentinela) {
			return http.StatusBadRequest, codigoDeLaOperacion, sentinela.Error()
		}
	}
	// Cualquier otro: la base, el libro, la red. Se manda el detalle completo
	// para que quede en el log; response.Error no lo deja salir en un 5xx.
	return http.StatusInternalServerError, codigoDeLaOperacion, err.Error()
}
