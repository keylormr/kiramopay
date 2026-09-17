package assistant

import (
	"context"
	"testing"

	"github.com/kiramopay/backend/internal/testutil"
)

// La cuota del asistente tenia el MISMO defecto que el limitador de tasa: INCR
// y EXPIRE en dos ordenes separadas. Si el proceso muere entre las dos —un
// despliegue, un reinicio, un OOM— la llave queda sin vencimiento, y una llave
// de cuota sin vencimiento no es "un dia de mas": el contador del dia sigue
// subiendo para siempre, asi que esa persona se queda sin asistente
// definitivamente. Si la que queda atascada es la global, se queda sin
// asistente la aplicacion entera.
func TestCuota_CuentaYFijaElVencimientoEnUnaSolaOrdenPorContador(t *testing.T) {
	espia := testutil.NuevoEspiaDeRedis()
	q := NewRedisQuota(espia.Cliente(), map[string]int{"free": 2}, 100, nil)

	res, err := q.Allow(context.Background(), "usuario-1")
	if err != nil {
		t.Fatalf("Allow: %v", err)
	}
	if !res.Allowed {
		t.Fatalf("el primer turno se rechazo: %+v", res)
	}

	// Un turno toca DOS contadores (el del usuario y el global): una orden cada
	// uno, no dos.
	ordenes := espia.Ordenes()
	if len(ordenes) != 2 {
		t.Fatalf("la cuota mando %d ordenes a Redis (%v); tienen que ser DOS, una por contador: entre INCR y EXPIRE, un reinicio deja el cupo diario sin reiniciarse nunca",
			len(ordenes), ordenes)
	}
	if !espia.TieneVencimiento(q.userKey("usuario-1")) {
		t.Fatal("el contador del usuario quedo sin vencimiento")
	}
	if !espia.TieneVencimiento(q.globalKey()) {
		t.Fatal("el contador global quedo sin vencimiento")
	}
}

// Lo que dejaba el codigo viejo si el proceso moria entre las dos ordenes: un
// contador que sube y no vence nunca. El siguiente turno tiene que devolverle
// su vencimiento; si no, ese cupo diario no se reinicia jamas.
func TestCuota_UnContadorSinVencimientoNoDejaAlUsuarioSinAsistente(t *testing.T) {
	client := testutil.TestRedis(t)
	ctx := context.Background()

	q := NewRedisQuota(client, map[string]int{"free": 50}, 100, nil)
	llave := q.userKey("usuario-atascado")
	if err := client.Set(ctx, llave, 3, 0).Err(); err != nil {
		t.Fatalf("sembrar el contador atascado: %v", err)
	}

	if _, err := q.Allow(ctx, "usuario-atascado"); err != nil {
		t.Fatalf("Allow: %v", err)
	}

	ttl, err := client.PTTL(ctx, llave).Result()
	if err != nil {
		t.Fatalf("leer el vencimiento de %s: %v", llave, err)
	}
	if ttl <= 0 {
		t.Fatalf("el contador %s sigue sin vencimiento (pttl = %v): ese cupo diario no se reinicia nunca", llave, ttl)
	}
	if ttl > quotaTTL {
		t.Fatalf("el vencimiento quedo en %v, mas que el TTL de la cuota (%v)", ttl, quotaTTL)
	}
}
