package middleware

import (
	"context"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/kiramopay/backend/pkg/response"
	"github.com/redis/go-redis/v9"
)

// limiterIP keys rate-limit windows by the resolved client IP instead of the
// raw RemoteAddr. Behind the Render proxy RemoteAddr is the proxy's address
// plus an ephemeral port, so keying on it neither identified the client nor
// produced stable windows. When nothing parses, fall back to RemoteAddr so a
// request is never left without a key.
func limiterIP(r *http.Request) string {
	if ip := RequestIP(r); ip != "" {
		return ip
	}
	return r.RemoteAddr
}

// Prefijos de los limitadores por IP. Cada uno es una ventana aparte en Redis:
// dos limitadores con el mismo prefijo cuentan en el MISMO contador, asi que
// una peticion que pasa por los dos suma dos veces y el cupo "propio" de una
// ruta se gasta con el trafico de cualquier otra.
//
// Eso le paso al login: su grupo usaba RateLimit, con el prefijo del limite
// global. Cada intento contaba doble y, en cuanto la IP llevaba 60 peticiones
// de cualquier tipo en el minuto (varias personas en la misma red, o alguien
// que navego y volvio a entrar), el login respondia 429.
const (
	// PrefijoLimiteGlobal es el del limite que cubre toda la API.
	PrefijoLimiteGlobal = "ratelimit"
	// PrefijoLimiteSalud es el de /health, que queda fuera del global.
	PrefijoLimiteSalud = "ratelimit:health"
	// PrefijoLimiteRefresh es el de POST /auth/refresh.
	PrefijoLimiteRefresh = "ratelimit:auth_refresh"
	// PrefijoLimiteAcceso es el de login, registro, OTP de registro y
	// recuperacion de contrasena.
	PrefijoLimiteAcceso = "ratelimit:auth"
)

// rateLimitKey namespaces a limiter window. Two limiters that must not consume
// each other's budget have to differ here — same prefix, same window.
func rateLimitKey(prefix string, r *http.Request) string {
	return fmt.Sprintf("%s:%s", prefix, limiterIP(r))
}

// inProcLimiter is a fixed-window in-process limiter used as a FAIL-DEGRADED
// fallback when Redis is unavailable, so rate limiting on sensitive routes does
// not silently disappear during a Redis outage. It is best-effort and
// per-process (not shared across replicas) — a backstop, not the primary limiter.
type inProcLimiter struct {
	mu      sync.Mutex
	windows map[string]*procWindow
}

type procWindow struct {
	count   int
	resetAt time.Time
}

func newInProcLimiter() *inProcLimiter {
	return &inProcLimiter{windows: make(map[string]*procWindow)}
}

// allow reports whether a request keyed by key is within limit for the window.
func (l *inProcLimiter) allow(key string, limit int, window time.Duration) bool {
	now := time.Now()
	l.mu.Lock()
	defer l.mu.Unlock()
	// Opportunistic cleanup so the map cannot grow without bound during an outage.
	if len(l.windows) > 10000 {
		for k, w := range l.windows {
			if now.After(w.resetAt) {
				delete(l.windows, k)
			}
		}
	}
	w := l.windows[key]
	if w == nil || now.After(w.resetAt) {
		l.windows[key] = &procWindow{count: 1, resetAt: now.Add(window)}
		return true
	}
	w.count++
	return w.count <= limit
}

// guionDeVentana cuenta la peticion y fija el vencimiento de la ventana en UNA
// sola orden atomica.
//
// Eran dos: INCR y, si el contador quedaba en 1, EXPIRE. Entre las dos hay una
// ventana, y si el proceso muere justo ahi —un despliegue, un reinicio, un
// OOM— la llave de esa IP queda SIN vencimiento, o sea para siempre. Desde
// entonces el contador no se reinicia nunca y, al pasar del tope acumulado
// historico, esa IP —que puede ser una oficina entera detras de un solo
// NAT— se queda con 429 en login, registro, OTP de registro, "olvide mi
// contrasena" y "restablecer", hasta que alguien borre la llave a mano en Redis.
//
// El `PTTL < 0` no es adorno: repara tambien las llaves que YA quedaron
// atascadas sin vencimiento, que es lo unico que las despega sin entrar a
// Redis a mano. PTTL devuelve -1 cuando la llave existe y no vence, y -2
// cuando no existe.
var guionDeVentana = redis.NewScript(`
local n = redis.call('INCR', KEYS[1])
if n == 1 or redis.call('PTTL', KEYS[1]) < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
return n
`)

// contarEnLaVentana devuelve cuantas peticiones lleva la clave en la ventana.
//
// El error se devuelve tal cual para que el llamante mantenga la politica de
// SIEMPRE: con Redis caido no se cierra el paso a nadie, se degrada al
// limitador en proceso.
func contarEnLaVentana(ctx context.Context, redisClient *redis.Client, key string, window time.Duration) (int64, error) {
	ms := window.Milliseconds()
	if ms < 1 {
		// PEXPIRE con 0 es un error de Redis; una ventana mas corta que un
		// milisegundo no existe en la practica, pero un cero silencioso dejaria
		// la llave sin vencer, que es justo lo que este guion vino a evitar.
		ms = 1
	}
	return guionDeVentana.Run(ctx, redisClient, []string{key}, ms).Int64()
}

// RateLimit es el limite GLOBAL por IP. Se registra una sola vez, para toda la
// API: un grupo de rutas que necesita su propio tope usa RateLimitKeyed con su
// propio prefijo, nunca RateLimit.
func RateLimit(redisClient *redis.Client, limit int, window time.Duration) func(http.Handler) http.Handler {
	return RateLimitKeyed(redisClient, PrefijoLimiteGlobal, limit, window)
}

// RateLimitKeyed is RateLimit under its own key namespace. A route that needs
// its own budget MUST use a distinct prefix (the Prefijo* constants above):
// sharing PrefijoLimiteGlobal would make its requests consume the global window
// it was meant to be independent of.
func RateLimitKeyed(redisClient *redis.Client, prefix string, limit int, window time.Duration) func(http.Handler) http.Handler {
	fallback := newInProcLimiter()
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			key := rateLimitKey(prefix, r)

			ctx := context.Background()
			count, err := contarEnLaVentana(ctx, redisClient, key, window)
			if err != nil {
				// Redis is down: fail DEGRADED to an in-process limiter rather
				// than open, so the brute-force/abuse backstop survives an outage.
				if !fallback.allow(key, limit, window) {
					response.Error(w, http.StatusTooManyRequests, "RATE_LIMITED", "too many requests, please try again later")
					return
				}
				next.ServeHTTP(w, r)
				return
			}

			if count > int64(limit) {
				response.Error(w, http.StatusTooManyRequests, "RATE_LIMITED", "too many requests, please try again later")
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

// RateLimitExcept applies rl to every request except the listed exact paths.
//
// It exists for /health: the probes that call it (the platform's own check,
// uptime monitors, internal probes) arrive without the header that identifies
// the client, so they all fall back to a single limiter key — and share it with
// whatever real traffic lands on that same fallback. Once that window filled,
// the health check itself started getting 429 and the platform read a healthy
// service as down.
func RateLimitExcept(rl func(http.Handler) http.Handler, paths ...string) func(http.Handler) http.Handler {
	exempt := make(map[string]struct{}, len(paths))
	for _, p := range paths {
		exempt[p] = struct{}{}
	}
	return func(next http.Handler) http.Handler {
		limited := rl(next)
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if _, skip := exempt[r.URL.Path]; skip {
				next.ServeHTTP(w, r)
				return
			}
			limited.ServeHTTP(w, r)
		})
	}
}

// UserRateLimit is user-based rate limiting for authenticated endpoints.
// Uses userID from context as key; falls back to IP if no userID.
func UserRateLimit(redisClient *redis.Client, limit int, window time.Duration) func(http.Handler) http.Handler {
	fallback := newInProcLimiter()
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			userID := GetUserID(r.Context())
			// El limite forma parte de la clave: dos UserRateLimit anidados (el
			// general del grupo protegido y uno mas estrecho por ruta) tienen que
			// llevar contadores distintos; con una sola clave por usuario cada
			// peticion contaba dos veces y el presupuesto "propio" era compartido.
			key := fmt.Sprintf("userlimit:%d:%s", limit, userID)
			if userID == "" {
				key = fmt.Sprintf("userlimit:%d:ip:%s", limit, limiterIP(r))
			}

			ctx := context.Background()
			count, err := contarEnLaVentana(ctx, redisClient, key, window)
			if err != nil {
				// Redis is down: fail DEGRADED to an in-process limiter, not open.
				if !fallback.allow(key, limit, window) {
					response.Error(w, http.StatusTooManyRequests, "RATE_LIMITED", "too many requests, please try again later")
					return
				}
				next.ServeHTTP(w, r)
				return
			}

			if count > int64(limit) {
				response.Error(w, http.StatusTooManyRequests, "RATE_LIMITED", "too many requests, please try again later")
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}
