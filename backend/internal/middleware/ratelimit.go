package middleware

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	jwtpkg "github.com/kiramopay/backend/pkg/jwt"
	"github.com/kiramopay/backend/pkg/response"
	"github.com/kiramopay/backend/pkg/ventanaredis"
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
	// PrefijoLimiteGlobalUsuario es el del limite global cuando la peticion
	// trae una sesion: ahi la cuenta va POR USUARIO y no por IP. No se compone
	// con rateLimitKey (esa arma claves por IP), sino con claveDeUsuario.
	PrefijoLimiteGlobalUsuario = "ratelimit:usuario"
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

// contarEnLaVentana devuelve cuantas peticiones lleva la clave en la ventana.
//
// Cuenta y fija el vencimiento en UNA sola orden atomica (ver pkg/ventanaredis:
// el guion vive ahi porque el mismo defecto estaba en el bloqueo de cuenta y en
// la cuota del asistente). El error se devuelve tal cual para que el llamante
// mantenga la politica de SIEMPRE: con Redis caido no se cierra el paso a
// nadie, se degrada al limitador en proceso.
func contarEnLaVentana(ctx context.Context, redisClient *redis.Client, key string, window time.Duration) (int64, error) {
	return ventanaredis.Contar(ctx, redisClient, key, window)
}

// cupo es lo que se le cobra a UNA peticion: en que contador y con que tope.
// Devolverlo por peticion es lo que permite que el limite global cuente por
// usuario cuando hay sesion y por IP cuando no la hay.
type cupo struct {
	clave string
	tope  int
}

// limitadorDeVentana es el cuerpo compartido de todos los limitadores: elige el
// contador con `cobrar`, lo suma en Redis y responde 429 al pasarse. Todos los
// limitadores pasan por aqui para que un arreglo —como el guion atomico— no
// quede aplicado en uno y faltando en el de al lado.
func limitadorDeVentana(redisClient *redis.Client, window time.Duration, cobrar func(*http.Request) cupo) func(http.Handler) http.Handler {
	fallback := newInProcLimiter()
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			c := cobrar(r)

			ctx := context.Background()
			count, err := contarEnLaVentana(ctx, redisClient, c.clave, window)
			if err != nil {
				// Redis is down: fail DEGRADED to an in-process limiter rather
				// than open, so the brute-force/abuse backstop survives an outage.
				if !fallback.allow(c.clave, c.tope, window) {
					response.Error(w, http.StatusTooManyRequests, "RATE_LIMITED", "too many requests, please try again later")
					return
				}
				next.ServeHTTP(w, r)
				return
			}

			if count > int64(c.tope) {
				response.Error(w, http.StatusTooManyRequests, "RATE_LIMITED", "too many requests, please try again later")
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

// RateLimit cuenta en la ventana global POR IP. El limite global de la API ya
// no se registra con este —lo hace RateLimitGlobal, que cobra por usuario
// cuando hay sesion—: queda para lo que de verdad se cuenta por direccion. Un
// grupo de rutas que necesita su propio tope usa RateLimitKeyed con su propio
// prefijo, nunca este.
func RateLimit(redisClient *redis.Client, limit int, window time.Duration) func(http.Handler) http.Handler {
	return RateLimitKeyed(redisClient, PrefijoLimiteGlobal, limit, window)
}

// RateLimitKeyed is RateLimit under its own key namespace. A route that needs
// its own budget MUST use a distinct prefix (the Prefijo* constants above):
// sharing PrefijoLimiteGlobal would make its requests consume the global window
// it was meant to be independent of.
func RateLimitKeyed(redisClient *redis.Client, prefix string, limit int, window time.Duration) func(http.Handler) http.Handler {
	return limitadorDeVentana(redisClient, window, func(r *http.Request) cupo {
		return cupo{clave: rateLimitKey(prefix, r), tope: limit}
	})
}

// SujetoDelLimite dice a quien se le cobra la peticion. Devuelve "" cuando no
// puede identificar a nadie, y entonces se cobra por IP.
type SujetoDelLimite func(*http.Request) string

// claveDeUsuario es la ventana global de una persona. El identificador es un
// UUID, asi que no puede colisionar con una clave por IP.
func claveDeUsuario(userID string) string {
	return fmt.Sprintf("%s:%s", PrefijoLimiteGlobalUsuario, userID)
}

// UsuarioDelToken identifica al dueno de la sesion leyendo el token de acceso
// del encabezado Authorization.
//
// La firma se VERIFICA. Leer las reclamaciones sin verificarlas seria peor que
// no identificar a nadie: cualquiera podria escribir un user_id distinto en
// cada peticion y estrenar una ventana limpia cada vez, o sea quedarse sin
// limite. Y por la misma razon no sirve tampoco usar el token en crudo como
// clave: un token inventado distinto por peticion tendria el mismo efecto.
//
// El token se vuelve a validar despues, en AuthWithSessionCheck, que ademas
// comprueba que la sesion no este revocada. Aqui no alcanza con eso —el
// limitador corre antes que la autenticacion, a proposito, para que el 429
// llegue antes de tocar la base— y la verificacion de una firma HMAC es
// microsegundos frente a lo que hace cualquier ruta.
//
// Una sesion revocada sigue contando en SU propia ventana hasta que el token
// venza; no puede gastarle el cupo a nadie mas, que es lo que importa aqui.
func UsuarioDelToken(jwtManager *jwtpkg.Manager) SujetoDelLimite {
	return func(r *http.Request) string {
		if jwtManager == nil {
			return ""
		}
		partes := strings.SplitN(r.Header.Get("Authorization"), " ", 2)
		if len(partes) != 2 || !strings.EqualFold(partes[0], "bearer") {
			return ""
		}
		claims, err := jwtManager.ValidateAccess(strings.TrimSpace(partes[1]))
		if err != nil {
			return ""
		}
		return claims.UserID
	}
}

// RateLimitGlobal es el limite que cubre toda la API, contado POR USUARIO
// cuando la peticion trae una sesion valida y POR IP cuando no la trae.
//
// Contarlo todo por IP era el defecto: una oficina, el CGNAT de un operador
// movil o dos personas en la misma casa comparten una sola direccion, asi que
// entre todas agotaban un cupo pensado para una, y la app respondia 429 a
// todas por uso perfectamente normal. El trafico autenticado es el grueso, y es
// el que si se puede atribuir a una persona: ese se cobra por usuario, y la IP
// queda solo para lo anonimo, que por cliente es poco.
//
// El limitador del login no pasa por aqui: tiene su propio prefijo y su propia
// cuenta, y es por IP a proposito (quien intenta entrar todavia no es nadie).
func RateLimitGlobal(redisClient *redis.Client, sujeto SujetoDelLimite, topeUsuario, topeIP int, window time.Duration) func(http.Handler) http.Handler {
	return limitadorDeVentana(redisClient, window, func(r *http.Request) cupo {
		if sujeto != nil {
			if userID := sujeto(r); userID != "" {
				return cupo{clave: claveDeUsuario(userID), tope: topeUsuario}
			}
		}
		return cupo{clave: rateLimitKey(PrefijoLimiteGlobal, r), tope: topeIP}
	})
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
	return limitadorDeVentana(redisClient, window, func(r *http.Request) cupo {
		userID := GetUserID(r.Context())
		// El limite forma parte de la clave: dos UserRateLimit anidados (el
		// general del grupo protegido y uno mas estrecho por ruta) tienen que
		// llevar contadores distintos; con una sola clave por usuario cada
		// peticion contaba dos veces y el presupuesto "propio" era compartido.
		key := fmt.Sprintf("userlimit:%d:%s", limit, userID)
		if userID == "" {
			key = fmt.Sprintf("userlimit:%d:ip:%s", limit, limiterIP(r))
		}
		return cupo{clave: key, tope: limit}
	})
}
