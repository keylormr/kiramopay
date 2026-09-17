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
// existe. Tambien cubre a un contador que quedo sin TTL por otro camino: en la
// cuota del asistente, un Refund que cruza la medianoche crea la llave del dia
// siguiente en -1 y sin vencimiento; el primer Contar de ese dia se lo devuelve.
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
