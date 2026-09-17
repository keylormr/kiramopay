package middleware

import (
	"context"
	"testing"
	"time"

	"github.com/kiramopay/backend/internal/testutil"
)

// El bloqueo de cuenta tenia el MISMO defecto que el limitador de tasa: INCR y
// EXPIRE en dos ordenes separadas. Si el proceso muere entre las dos —un
// despliegue, un reinicio, un OOM— la llave queda sin vencimiento, o sea para
// siempre, y el contador de intentos fallidos de esa cuenta no se reinicia
// nunca: al llegar a 5, AccountLockoutCheck responde 423 en cada login y esa
// persona no puede volver a entrar hasta que alguien borre la llave a mano.
func TestBloqueo_CuentaYFijaElVencimientoEnUnaSolaOrden(t *testing.T) {
	espia := testutil.NuevoEspiaDeRedis()
	store := NewRedisLockoutStore(espia.Cliente(), 15*time.Minute)

	if n := store.IncrLockout("lockout:cedula:abc"); n != 1 {
		t.Fatalf("el contador quedo en %d, se esperaba 1", n)
	}

	ordenes := espia.Ordenes()
	if len(ordenes) != 1 {
		t.Fatalf("el bloqueo mando %d ordenes a Redis (%v); tiene que ser UNA sola: entre dos, un reinicio deja la cuenta bloqueada para siempre",
			len(ordenes), ordenes)
	}
	if !espia.TieneVencimiento("lockout:cedula:abc") {
		t.Fatal("la llave del bloqueo quedo sin vencimiento")
	}
}

// Lo que dejaba el codigo viejo si el proceso moria entre las dos ordenes: una
// llave que cuenta y no vence nunca. El siguiente intento fallido tiene que
// devolverle un vencimiento; si no, esa cuenta no se libera sola jamas.
func TestBloqueo_UnaLlaveSinVencimientoNoDejaLaCuentaAtascada(t *testing.T) {
	client := testutil.TestRedis(t)
	ctx := context.Background()

	const llave = "lockout:cedula:atascada"
	if err := client.Set(ctx, llave, 5, 0).Err(); err != nil {
		t.Fatalf("sembrar la llave atascada: %v", err)
	}

	store := NewRedisLockoutStore(client, 15*time.Minute)
	if n := store.IncrLockout(llave); n != 6 {
		t.Fatalf("el contador quedo en %d, se esperaba 6", n)
	}

	ttl, err := client.PTTL(ctx, llave).Result()
	if err != nil {
		t.Fatalf("leer el vencimiento de %s: %v", llave, err)
	}
	if ttl <= 0 {
		t.Fatalf("la llave %s sigue sin vencimiento (pttl = %v): esa cuenta queda bloqueada hasta que alguien la borre a mano", llave, ttl)
	}
}
