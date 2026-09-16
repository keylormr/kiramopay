package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/kiramopay/backend/internal/testutil"
	"github.com/redis/go-redis/v9"
)

// Estas pruebas necesitan el Redis de pruebas: el respaldo en proceso lleva un
// contador por limitador, asi que con Redis caido dos limitadores con el mismo
// prefijo NUNCA comparten ventana y el defecto no se ve.

const (
	topeGlobalPrueba = 100
	topeAccesoPrueba = 60
)

// routerDeLimites arma los limites como cmd/api/main.go: el global para toda la
// API y, dentro, el grupo de acceso con su propio tope. limiteAcceso es el
// limitador de ese grupo, para poder comparar el prefijo propio con el global.
func routerDeLimites(client *redis.Client, limiteAcceso func(http.Handler) http.Handler) http.Handler {
	ok := func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) }
	r := chi.NewRouter()
	r.Use(RateLimitExcept(RateLimit(client, topeGlobalPrueba, time.Minute), "/health"))
	r.Get("/api/v1/wallets/me", ok)
	r.Group(func(r chi.Router) {
		r.Use(limiteAcceso)
		r.Post("/api/v1/auth/login", ok)
	})
	return r
}

func pedirConIP(h http.Handler, metodo, ruta, ip string) int {
	req := httptest.NewRequest(metodo, ruta, nil)
	req.RemoteAddr = ip + ":40000"
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec.Code
}

// Varias personas detras de la misma IP (una oficina, un WiFi publico) navegan
// la app: ese trafico no puede dejar a nadie sin poder iniciar sesion.
func TestLimiteDeAcceso_ElTraficoGeneralNoGastaElCupoDelLogin(t *testing.T) {
	client := testutil.TestRedis(t)
	h := routerDeLimites(client, RateLimitKeyed(client, PrefijoLimiteAcceso, topeAccesoPrueba, time.Minute))
	const ip = "203.0.113.10"

	for i := 1; i <= topeAccesoPrueba+10; i++ {
		if code := pedirConIP(h, http.MethodGet, "/api/v1/wallets/me", ip); code != http.StatusOK {
			t.Fatalf("peticion general %d: got %d, want %d", i, code, http.StatusOK)
		}
	}
	if code := pedirConIP(h, http.MethodPost, "/api/v1/auth/login", ip); code != http.StatusOK {
		t.Fatalf("login despues de %d peticiones generales: got %d, want %d", topeAccesoPrueba+10, code, http.StatusOK)
	}
}

// Cada intento de login cuenta UNA vez en la ventana global, como cualquier
// otra peticion: 40 logins y 60 peticiones generales llenan justo las 100.
func TestLimiteDeAcceso_ElLoginCuentaUnaSolaVezEnElGlobal(t *testing.T) {
	client := testutil.TestRedis(t)
	h := routerDeLimites(client, RateLimitKeyed(client, PrefijoLimiteAcceso, topeAccesoPrueba, time.Minute))
	const ip = "203.0.113.11"
	const logins = 40

	for i := 1; i <= logins; i++ {
		if code := pedirConIP(h, http.MethodPost, "/api/v1/auth/login", ip); code != http.StatusOK {
			t.Fatalf("login %d: got %d, want %d", i, code, http.StatusOK)
		}
	}
	for i := 1; i <= topeGlobalPrueba-logins; i++ {
		if code := pedirConIP(h, http.MethodGet, "/api/v1/wallets/me", ip); code != http.StatusOK {
			t.Fatalf("peticion general %d despues de %d logins: got %d, want %d", i, logins, code, http.StatusOK)
		}
	}
	// La ventana global quedo llena: la siguiente si se frena.
	if code := pedirConIP(h, http.MethodGet, "/api/v1/wallets/me", ip); code != http.StatusTooManyRequests {
		t.Fatalf("peticion %d de la ventana global: got %d, want %d", topeGlobalPrueba+1, code, http.StatusTooManyRequests)
	}
}

// Separar las ventanas no quita el tope propio del login.
func TestLimiteDeAcceso_ConservaSuPropioTope(t *testing.T) {
	client := testutil.TestRedis(t)
	h := routerDeLimites(client, RateLimitKeyed(client, PrefijoLimiteAcceso, topeAccesoPrueba, time.Minute))
	const ip = "203.0.113.12"

	for i := 1; i <= topeAccesoPrueba; i++ {
		if code := pedirConIP(h, http.MethodPost, "/api/v1/auth/login", ip); code != http.StatusOK {
			t.Fatalf("login %d: got %d, want %d", i, code, http.StatusOK)
		}
	}
	if code := pedirConIP(h, http.MethodPost, "/api/v1/auth/login", ip); code != http.StatusTooManyRequests {
		t.Fatalf("login %d: got %d, want %d", topeAccesoPrueba+1, code, http.StatusTooManyRequests)
	}
	// Otra IP no hereda ese tope.
	if code := pedirConIP(h, http.MethodPost, "/api/v1/auth/login", "203.0.113.13"); code != http.StatusOK {
		t.Fatalf("login desde otra IP: got %d, want %d", code, http.StatusOK)
	}
}

// Testigo del defecto: con el prefijo del global (lo que hacia main.go con
// RateLimit), el trafico general dejaba el login en 429. Si con esa
// configuracion el login dejara de recibir 429, las pruebas de arriba ya no
// distinguirian la configuracion buena de la mala.
func TestLimiteDeAcceso_ConElPrefijoGlobalElLoginSeBloqueaba(t *testing.T) {
	client := testutil.TestRedis(t)
	h := routerDeLimites(client, RateLimit(client, topeAccesoPrueba, time.Minute))
	const ip = "203.0.113.14"

	for i := 1; i <= topeAccesoPrueba+10; i++ {
		if code := pedirConIP(h, http.MethodGet, "/api/v1/wallets/me", ip); code != http.StatusOK {
			t.Fatalf("peticion general %d: got %d, want %d", i, code, http.StatusOK)
		}
	}
	if code := pedirConIP(h, http.MethodPost, "/api/v1/auth/login", ip); code != http.StatusTooManyRequests {
		t.Fatalf("con el prefijo compartido el login deberia recibir 429, got %d", code)
	}
}
