package qrpayment

import "errors"

// Errores tipados del camino de pago por QR.
//
// Hasta ahora el handler respondia siempre PAYMENT_FAILED y el adaptador del
// frontend encima lo pisaba con su propio codigo generico, asi que el motivo
// real nunca llegaba a la pantalla: al usuario se le decia "no se pudo pagar"
// sin decirle por que, y no habia forma de distinguir "el cajero cambio el
// monto" de "no te alcanza el saldo".
//
// Cada uno de estos tiene un codigo propio en el handler.
var (
	// ErrQRInvalido: la cadena no corresponde a ningun codigo ni cobro vivo.
	ErrQRInvalido = errors.New("qr invalido")

	// ErrQRRevocado: el codigo permanente fue retirado por su dueno. Es lo que
	// protege al que pego un afiche que despues se fotografio.
	ErrQRRevocado = errors.New("el codigo fue revocado")

	// ErrCobroReemplazado: el pagador esta mirando un cobro que ya no es el
	// vigente — el cajero subio el monto mientras el miraba. Nunca se le cobra a
	// nadie un monto que no vio en pantalla.
	ErrCobroReemplazado = errors.New("el cobro fue reemplazado")

	// ErrCobroYaPagado: alguien lo pago primero. En el camino de cancelar o
	// cambiar el monto, es el error que impide decirle "cancelado" al cajero
	// sobre una venta que acaba de entrar.
	ErrCobroYaPagado = errors.New("el cobro ya fue pagado")

	ErrCobroVencido   = errors.New("el cobro vencio")
	ErrCobroCancelado = errors.New("el cobro fue cancelado")

	// ErrCobroNoReclamable lo devuelve el gancho cuando el UPDATE guardado no
	// afecta filas. Quien llama lo traduce leyendo el estado real.
	ErrCobroNoReclamable = errors.New("el cobro ya no se puede reclamar")

	ErrNoPodesPagarte = errors.New("no podes pagarte a vos mismo")
	ErrMontoRequerido = errors.New("este codigo necesita que indiques el monto")

	// ErrMontoInvalido: un cobro con monto cero o negativo. La pantalla ya no
	// deja llegar aca, pero otro cliente si, y recibia "amount must be
	// positive" en ingles bajo el PAYMENT_FAILED generico.
	ErrMontoInvalido = errors.New("el monto debe ser mayor que cero")

	// ErrCedulaSinCuenta: se quiso sumar al equipo del comercio una cedula que
	// no es de ninguna cuenta. Salia como ADD_STAFF_FAILED con la frase en
	// ingles, igual que un rol invalido: la pantalla no podia distinguirlos.
	ErrCedulaSinCuenta = errors.New("no KiramoPay user with that cedula")

	// ErrLlaveReutilizada: llego un nonce ya usado pero describiendo otro pago.
	// El nonce lo controla quien recibe la mercaderia, asi que no alcanza con
	// devolver el pago viejo: hay que comparar antes.
	ErrLlaveReutilizada = errors.New("la llave de idempotencia ya se uso para otro pago")

	// ErrNonceInvalido: el nonce vino mal formado. NUNCA se inventa uno en el
	// servidor — inventarlo convierte un doble toque en un doble cobro real.
	ErrNonceInvalido = errors.New("idempotency_key invalida")

	// ErrCobroDuplicadoAppVieja: una aplicacion vieja no manda nonce, asi que su
	// llave sobre un codigo permanente es fija y solo sirve una vez. En vez de
	// devolver un exito falso, se le dice que actualice.
	ErrCobroDuplicadoAppVieja = errors.New("actualiza la aplicacion para volver a pagar este codigo")

	// ErrPagoNoRegistrado: el libro dice que este pago ya existe pero no hay
	// venta escrita. Es inalcanzable con la llave nueva; se defiende igual,
	// porque la alternativa seria fabricar una venta que nadie hizo.
	ErrPagoNoRegistrado = errors.New("el pago no quedo registrado")

	// ErrQRDeComercio: se escaneo el codigo de un comercio donde hacia falta el
	// de una persona. Lo usa el envio de cripto: un comercio cobra en colones o
	// dolares por el camino del libro, y no tiene donde recibir un activo.
	ErrQRDeComercio = errors.New("ese codigo es de un comercio")

	// ErrQRDeCobro: se escaneo un cobro —un monto en fiat que alguien pidio— en
	// vez del codigo personal. Enviar cripto contra el ignoraria en silencio el
	// monto que esa persona pidio, que es justamente lo que el cobro vino a
	// evitar.
	ErrQRDeCobro = errors.New("ese codigo es un cobro en dinero")
)

// Errores de los planes del comercio.
var (
	// ErrPlanAnaliticaRequerido: la exportacion del reporte es del plan
	// analitica. El handler responde 403 PLAN_REQUIRED con el plan que falta.
	ErrPlanAnaliticaRequerido = errors.New("el comercio necesita el plan analitica")

	// ErrPlanComercioInvalido: un plan de comercio que no es base ni analitica,
	// escrito exactamente asi.
	ErrPlanComercioInvalido = errors.New("plan de comercio invalido")

	// ErrComercioNoEncontrado: no existe un comercio con ese id.
	ErrComercioNoEncontrado = errors.New("merchant not found")
)
