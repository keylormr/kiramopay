package middleware

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/kiramopay/backend/internal/testutil"
	"github.com/redis/go-redis/v9"
)

// Contar la peticion y fijar el vencimiento de la ventana tienen que ser UNA
// sola cosa.
//
// Cuando eran dos ordenes —INCR y despues EXPIRE— habia una ventana entre
// ellas: si el proceso moria justo ahi (un despliegue, un reinicio, un OOM) la
// llave de esa IP quedaba SIN vencimiento, o sea para siempre. Desde entonces
// el contador no se reinicia nunca y, al pasar de los 60 acumulados, esa IP
// —que puede ser una oficina entera— se queda con 429 en login, registro, OTP,
// "olvide mi contrasena" y "restablecer" hasta que alguien borre la llave a
// mano en Redis.

// espiaDeRedis responde las ordenes dentro del proceso, antes de que salgan a
// la red: la prueba no necesita un Redis vivo y ve EXACTAMENTE cuantas ordenes
// manda el limitador por peticion.
type espiaDeRedis struct {
	mu       sync.Mutex
	ordenes  []string
	cuenta   map[string]int64
	conVence map[string]bool
}

func nuevoEspiaDeRedis() *espiaDeRedis {
	return &espiaDeRedis{cuenta: map[string]int64{}, conVence: map[string]bool{}}
}

func (e *espiaDeRedis) DialHook(next redis.DialHook) redis.DialHook { return next }

func (e *espiaDeRedis) ProcessPipelineHook(next redis.ProcessPipelineHook) redis.ProcessPipelineHook {
	return next
}

func (e *espiaDeRedis) ProcessHook(_ redis.ProcessHook) redis.ProcessHook {
	return func(_ context.Context, cmd redis.Cmder) error { return e.responder(cmd) }
}

func (e *espiaDeRedis) responder(cmd redis.Cmder) error {
	e.mu.Lock()
	defer e.mu.Unlock()

	nombre := cmd.Name()
	e.ordenes = append(e.ordenes, nombre)
	args := cmd.Args()

	switch nombre {
	case "incr":
		llave := fmt.Sprint(args[1])
		e.cuenta[llave]++
		c, ok := cmd.(*redis.IntCmd)
		if !ok {
			return fmt.Errorf("incr devolvio %T", cmd)
		}
		c.SetVal(e.cuenta[llave])
	case "expire", "pexpire":
		llave := fmt.Sprint(args[1])
		e.conVence[llave] = true
		c, ok := cmd.(*redis.BoolCmd)
		if !ok {
			return fmt.Errorf("%s devolvio %T", nombre, cmd)
		}
		c.SetVal(true)
	case "eval", "evalsha":
		// EVAL <guion> <cuantas llaves> <llave> ...: el guion cuenta y fija el
		// vencimiento de una sola vez, asi que aqui se emulan las dos cosas.
		llave := fmt.Sprint(args[3])
		e.cuenta[llave]++
		e.conVence[llave] = true
		c, ok := cmd.(*redis.Cmd)
		if !ok {
			return fmt.Errorf("%s devolvio %T", nombre, cmd)
		}
		c.SetVal(e.cuenta[llave])
	default:
		return fmt.Errorf("orden no esperada: %s", nombre)
	}
	return nil
}

func clienteEspiado(e *espiaDeRedis) *redis.Client {
	// La direccion no importa: el espia responde antes de que se abra ninguna
	// conexion.
	c := redis.NewClient(&redis.Options{Addr: "127.0.0.1:1"})
	c.AddHook(e)
	return c
}

func siempreOK() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
}

func TestLimitador_CuentaYFijaElVencimientoEnUnaSolaOrden(t *testing.T) {
	espia := nuevoEspiaDeRedis()
	h := RateLimit(clienteEspiado(espia), 5, time.Minute)(siempreOK())

	req := httptest.NewRequest(http.MethodGet, "/api/v1/wallets/me", nil)
	req.RemoteAddr = "203.0.113.70:40000"
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("la peticion devolvio %d, se esperaba %d", rec.Code, http.StatusOK)
	}

	if n := len(espia.ordenes); n != 1 {
		t.Fatalf("el limitador mando %d ordenes a Redis (%v); tiene que ser UNA sola: entre dos, un reinicio deja la llave sin vencimiento para siempre",
			n, espia.ordenes)
	}
	llave := rateLimitKey(PrefijoLimiteGlobal, req)
	if !espia.conVence[llave] {
		t.Fatalf("la llave %s quedo sin vencimiento", llave)
	}
}

// El limitador por usuario cuenta en otra tabla de llaves pero tiene el mismo
// mecanismo, y por lo tanto tenia la misma ventana.
func TestLimitadorPorUsuario_CuentaYFijaElVencimientoEnUnaSolaOrden(t *testing.T) {
	espia := nuevoEspiaDeRedis()
	h := UserRateLimit(clienteEspiado(espia), 5, time.Minute)(siempreOK())

	req := httptest.NewRequest(http.MethodGet, "/api/v1/wallets/me", nil)
	req.RemoteAddr = "203.0.113.72:40000"
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("la peticion devolvio %d, se esperaba %d", rec.Code, http.StatusOK)
	}

	if n := len(espia.ordenes); n != 1 {
		t.Fatalf("el limitador por usuario mando %d ordenes a Redis (%v); tiene que ser UNA sola",
			n, espia.ordenes)
	}
}

// Lo que dejaba el codigo viejo si el proceso moria entre las dos ordenes: una
// llave que cuenta y no vence nunca. La siguiente peticion tiene que devolverle
// un vencimiento; si no, esa IP no se libera sola jamas.
func TestLimitador_UnaLlaveSinVencimientoNoDejaALaIPAtascada(t *testing.T) {
	client := testutil.TestRedis(t)
	ctx := context.Background()

	const ip = "203.0.113.71"
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", nil)
	req.RemoteAddr = ip + ":40000"
	llave := rateLimitKey(PrefijoLimiteAcceso, req)

	if err := client.Set(ctx, llave, 5, 0).Err(); err != nil {
		t.Fatalf("sembrar la llave atascada: %v", err)
	}

	h := RateLimitKeyed(client, PrefijoLimiteAcceso, 60, time.Minute)(siempreOK())
	if code := pedirConIP(h, http.MethodPost, "/api/v1/auth/login", ip); code != http.StatusOK {
		t.Fatalf("la peticion devolvio %d, se esperaba %d", code, http.StatusOK)
	}

	ttl, err := client.PTTL(ctx, llave).Result()
	if err != nil {
		t.Fatalf("leer el vencimiento de %s: %v", llave, err)
	}
	if ttl <= 0 {
		t.Fatalf("la llave %s sigue sin vencimiento (pttl = %v): esa IP queda con 429 hasta que alguien la borre a mano", llave, ttl)
	}
}
