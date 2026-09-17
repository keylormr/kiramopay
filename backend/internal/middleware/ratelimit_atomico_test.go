package middleware

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/kiramopay/backend/internal/testutil"
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

func siempreOK() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
}

func TestLimitador_CuentaYFijaElVencimientoEnUnaSolaOrden(t *testing.T) {
	espia := testutil.NuevoEspiaDeRedis()
	h := RateLimit(espia.Cliente(), 5, time.Minute)(siempreOK())

	req := httptest.NewRequest(http.MethodGet, "/api/v1/wallets/me", nil)
	req.RemoteAddr = "203.0.113.70:40000"
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("la peticion devolvio %d, se esperaba %d", rec.Code, http.StatusOK)
	}

	if n := len(espia.Ordenes()); n != 1 {
		t.Fatalf("el limitador mando %d ordenes a Redis (%v); tiene que ser UNA sola: entre dos, un reinicio deja la llave sin vencimiento para siempre",
			n, espia.Ordenes())
	}
	llave := rateLimitKey(PrefijoLimiteGlobal, req)
	if !espia.TieneVencimiento(llave) {
		t.Fatalf("la llave %s quedo sin vencimiento", llave)
	}
}

// El limitador por usuario cuenta en otra tabla de llaves pero tiene el mismo
// mecanismo, y por lo tanto tenia la misma ventana.
func TestLimitadorPorUsuario_CuentaYFijaElVencimientoEnUnaSolaOrden(t *testing.T) {
	espia := testutil.NuevoEspiaDeRedis()
	h := UserRateLimit(espia.Cliente(), 5, time.Minute)(siempreOK())

	req := httptest.NewRequest(http.MethodGet, "/api/v1/wallets/me", nil)
	req.RemoteAddr = "203.0.113.72:40000"
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("la peticion devolvio %d, se esperaba %d", rec.Code, http.StatusOK)
	}

	if n := len(espia.Ordenes()); n != 1 {
		t.Fatalf("el limitador por usuario mando %d ordenes a Redis (%v); tiene que ser UNA sola",
			n, espia.Ordenes())
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
