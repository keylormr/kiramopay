package assistant

import (
	"context"
	"testing"
	"time"

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

// Devolver una unidad no puede INVENTAR el contador. DECR a la llave que no
// encuentra la crea: la pone en 0 y la baja a -1, sin vencimiento. O sea que el
// camino de devolver fabricaba justo la llave eterna que se cerro en el camino
// de contar, entrando por la puerta de atras.
func TestCuota_UnaDevolucionNoInventaElContador(t *testing.T) {
	espia := testutil.NuevoEspiaDeRedis()
	q := NewRedisQuota(espia.Cliente(), map[string]int{"free": 2}, 100, nil)

	q.Refund(context.Background(), "nadie")

	for _, llave := range []string{q.userKey("nadie"), q.globalKey()} {
		if espia.Existe(llave) {
			t.Fatalf("la devolucion creo el contador %s, que no existia: queda en -1, sin vencimiento y con un turno regalado para el dia siguiente", llave)
		}
	}
}

// El caso real que lo dispara: el turno empieza a las 23:59:59 UTC, falla, y la
// devolucion corre ya en el dia siguiente —el dia se recalcula al devolver—
// contra unas llaves que todavia no existen.
//
// Con DECR quedaban creadas en -1 y sin vencimiento. La reparacion de
// ventanaredis.Contar no las salvaba: solo despega la llave de quien vuelve a
// escribirle al asistente ESE mismo dia, y quien acaba de comerse un fallo
// muchas veces no vuelve. Ademas el dia nuevo arrancaba en negativo, o sea
// dando un turno mas de los que paga el plan.
func TestCuota_LaDevolucionQueCruzaLaMedianocheNoDejaLlaveEterna(t *testing.T) {
	client := testutil.TestRedis(t)
	ctx := context.Background()

	ahora := time.Date(2026, 9, 18, 23, 59, 59, 0, time.UTC)
	q := NewRedisQuota(client, map[string]int{"free": 2}, 100, nil)
	q.clock = func() time.Time { return ahora }

	res, err := q.Allow(ctx, "trasnochador")
	if err != nil || !res.Allowed {
		t.Fatalf("el turno de la noche se rechazo: %+v, %v", res, err)
	}

	// El modelo falla y la devolucion corre ya pasada la medianoche.
	ahora = ahora.Add(2 * time.Second)
	q.Refund(ctx, "trasnochador")

	for _, llave := range []string{q.userKey("trasnochador"), q.globalKey()} {
		n, err := client.Exists(ctx, llave).Result()
		if err != nil {
			t.Fatalf("Exists %s: %v", llave, err)
		}
		if n == 0 {
			continue // lo correcto: no habia nada que devolver y no se invento nada
		}
		ttl, err := client.PTTL(ctx, llave).Result()
		if err != nil {
			t.Fatalf("leer el vencimiento de %s: %v", llave, err)
		}
		t.Fatalf("la devolucion creo el contador %s del dia siguiente (pttl = %v, -1 es sin vencimiento): esa llave se queda en Redis para siempre", llave, ttl)
	}

	// Y el dia nuevo tiene que dar los turnos del plan, ni uno mas.
	permitidos := 0
	for i := 0; i < 5; i++ {
		res, err := q.Allow(ctx, "trasnochador")
		if err != nil {
			t.Fatalf("Allow del dia nuevo: %v", err)
		}
		if !res.Allowed {
			break
		}
		permitidos++
	}
	if permitidos != 2 {
		t.Fatalf("el dia nuevo dio %d turnos y el plan son 2: el contador arranco en negativo por la devolucion", permitidos)
	}
}
