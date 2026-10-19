package middleware

import (
	"reflect"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
)

// El cierre de un comercio no se confirma sin contar el intento. Para eso
// necesita un contador que diga que no pudo, y no el 0 con el que IncrLockout
// deja pasar el login cuando Redis no contesta. Si el tope de produccion no lo
// ofrece, el cierre no tiene como saberlo y vuelve a dejar pasar.
func TestRedisLockoutStore_ContarIntentoDiceQueNoPudo(t *testing.T) {
	store := NewRedisLockoutStore(redis.NewClient(&redis.Options{Addr: "localhost:99999"}), time.Minute)
	estricto, ok := any(store).(interface {
		ContarIntento(key string) (int64, error)
	})
	if !ok {
		t.Fatal("RedisLockoutStore no sabe decir que no pudo contar un intento")
	}
	if _, err := estricto.ContarIntento("lockout:prueba:estricto"); err == nil {
		t.Fatal("sin Redis, ContarIntento no devolvio error")
	}
}

// Y la interfaz lo exige: si quien arma el servicio envuelve el tope (metricas,
// un decorador), el envoltorio tiene que saber contar con error. Antes el
// cierre lo buscaba con una asercion de tipo y, si no estaba, volvia en
// silencio al contador que deja pasar.
func TestLockoutStore_ExigeContarIntento(t *testing.T) {
	if _, ok := reflect.TypeOf((*LockoutStore)(nil)).Elem().MethodByName("ContarIntento"); !ok {
		t.Fatal("LockoutStore no exige ContarIntento: un tope envuelto deja pasar el cierre sin contar")
	}
}
