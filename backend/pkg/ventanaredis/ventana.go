// Package ventanaredis cuenta en una ventana de tiempo de Redis sin dejar
// nunca una llave sin vencimiento.
//
// Existe porque el mismo defecto aparecio en tres contadores distintos: el
// limitador de tasa, el bloqueo de cuenta por intentos fallidos y la cuota
// diaria del asistente. Los tres hacian INCR y, si el contador quedaba en 1,
// EXPIRE — dos ordenes, con una ventana entre ellas. Si el proceso muere justo
// ahi (un despliegue, un reinicio, un OOM) la llave queda SIN vencimiento, o
// sea para siempre, y a partir de ese momento el contador no se reinicia nunca:
//
//   - en el limitador, esa IP se queda con 429 hasta que alguien borre la llave;
//   - en el bloqueo, esa CUENTA no puede volver a entrar jamas;
//   - en la cuota del asistente, ese usuario se queda sin asistente para siempre.
//
// Tener el guion en un solo lugar es lo que evita que el arreglo viva en un
// contador y falte en el vecino, que es exactamente lo que habia pasado.
//
// Restar es la operacion espejo, y esta aqui por la misma razon: devolver una
// unidad con un DECR a secas FABRICA la llave eterna que Contar vino a evitar.
package ventanaredis

import (
	"context"
	"time"

	"github.com/redis/go-redis/v9"
)

// guion cuenta la peticion y fija el vencimiento de la ventana en UNA sola
// orden atomica.
//
// El `PTTL < 0` no es adorno: repara tambien las llaves que YA quedaron
// atascadas sin vencimiento, que es lo unico que las despega sin entrar a Redis
// a mano. PTTL devuelve -1 cuando la llave existe y no vence, y -2 cuando no
// existe. Eso cubre las que dejo el codigo viejo antes de que estas tres
// operaciones fueran atomicas, y las que pueda dejar cualquier otro camino.
//
// Reparar no es lo mismo que no ensuciar: una llave solo se despega si alguien
// vuelve a contar sobre ella, y a la de una persona que no vuelve no la toca
// nadie. Por eso Restar no crea llaves, en vez de crearlas y confiar en que
// algun Contar futuro las arregle.
var guion = redis.NewScript(`
local n = redis.call('INCR', KEYS[1])
if n == 1 or redis.call('PTTL', KEYS[1]) < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
return n
`)

// Contar suma uno a la llave y garantiza que tenga vencimiento, todo en la
// misma orden. Devuelve cuanto lleva acumulado la ventana.
//
// El error se devuelve tal cual: cada llamante decide su politica cuando Redis
// no responde (el limitador se degrada a un contador en proceso, la cuota falla
// cerrada). Aqui no se toma esa decision por nadie.
func Contar(ctx context.Context, rdb redis.Scripter, llave string, ventana time.Duration) (int64, error) {
	ms := ventana.Milliseconds()
	if ms < 1 {
		// PEXPIRE con 0 es un error de Redis; una ventana mas corta que un
		// milisegundo no existe en la practica, pero un cero silencioso dejaria
		// la llave sin vencer, que es justo lo que este guion vino a evitar.
		ms = 1
	}
	return guion.Run(ctx, rdb, []string{llave}, ms).Int64()
}

// guionRestar devuelve una unidad al contador, pero SOLO si la llave existe.
//
// DECR a secas crea la llave que no encuentra: la pone en 0 y la baja a -1, sin
// vencimiento. O sea que devolver una unidad podia fabricar exactamente lo que
// este paquete existe para evitar —un contador que no vence nunca— y ademas
// dejarlo arrancando en negativo, o sea con una unidad de cupo regalada.
//
// Pasa de verdad en la cuota del asistente: un turno que empieza antes de la
// medianoche UTC y falla despues devuelve la unidad a la llave del dia
// SIGUIENTE, que todavia no existe. Tambien cuando la llave se perdio por una
// eviccion, que en un Redis con tope de memoria es cosa de todos los dias.
//
// No crear la llave es ademas lo unico que hace cierta la politica que declara
// quien llama: una devolucion perdida deja el cupo del dia un poco mas
// estricto, nunca mas flojo.
var guionRestar = redis.NewScript(`
if redis.call('EXISTS', KEYS[1]) == 0 then
  return 0
end
return redis.call('DECR', KEYS[1])
`)

// Restar devuelve una unidad a la llave y responde cuanto quedo. Si la llave no
// existe devuelve 0 y no la crea: no hay ventana a la que devolverle nada.
//
// El vencimiento no se toca a proposito: DECR sobre una llave que ya existe lo
// conserva, y toda llave nace con el suyo desde Contar.
func Restar(ctx context.Context, rdb redis.Scripter, llave string) (int64, error) {
	return guionRestar.Run(ctx, rdb, []string{llave}).Int64()
}
