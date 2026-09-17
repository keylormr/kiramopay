package middleware

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"time"

	"github.com/kiramopay/backend/pkg/identifier"
	"github.com/kiramopay/backend/pkg/response"
	"github.com/kiramopay/backend/pkg/ventanaredis"
	"github.com/redis/go-redis/v9"
)

// LockoutStore abstracts lockout counter operations.
type LockoutStore interface {
	IncrLockout(key string) int64
	ResetLockout(key string)
	GetLockout(key string) int64
}

// RedisLockoutStore implements LockoutStore using Redis.
type RedisLockoutStore struct {
	client *redis.Client
	ttl    time.Duration
}

// NewRedisLockoutStore creates a new Redis-backed lockout store.
func NewRedisLockoutStore(client *redis.Client, ttl time.Duration) *RedisLockoutStore {
	return &RedisLockoutStore{client: client, ttl: ttl}
}

// IncrLockout suma un intento fallido y deja la llave SIEMPRE con vencimiento,
// en una sola orden atomica.
//
// Eran dos ordenes —INCR y, si el contador quedaba en 1, EXPIRE— con una
// ventana entre ellas: si el proceso moria justo ahi (un despliegue, un
// reinicio, un OOM) la llave quedaba sin vencimiento, o sea para siempre. Desde
// ese momento el contador de esa cuenta no se reinicia nunca y, al llegar a los
// 5 intentos acumulados, AccountLockoutCheck responde 423 en cada login: esa
// persona no puede volver a entrar hasta que alguien borre la llave a mano en
// Redis. El mismo defecto que el limitador de tasa, en el vecino de al lado.
//
// El guion repara ademas las llaves que YA quedaron atascadas sin vencimiento:
// el siguiente intento fallido les devuelve su TTL y la cuenta se libera sola.
func (s *RedisLockoutStore) IncrLockout(key string) int64 {
	count, err := ventanaredis.Contar(context.Background(), s.client, key, s.ttl)
	if err != nil {
		return 0
	}
	return count
}

func (s *RedisLockoutStore) ResetLockout(key string) {
	s.client.Del(context.Background(), key)
}

func (s *RedisLockoutStore) GetLockout(key string) int64 {
	val, err := s.client.Get(context.Background(), key).Int64()
	if err != nil {
		return 0
	}
	return val
}

// AccountLockoutCheck middleware blocks requests if the account has too many
// failed login attempts. It reads the request body to extract the login
// identifier (cedula, correo o telefono — campo `identifier` o el alias legado
// `cedula`) and checks the counter under identifier.LockoutKey: EXACTAMENTE la
// misma clave canonica, tipada y hasheada que construye el servicio de auth. Si las
// claves divergieran, el 423 y el contador quedarian desincronizados y cada
// intento contra una cuenta bloqueada quemaria un Argon2 completo.
func AccountLockoutCheck(store LockoutStore, maxAttempts int) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			body, err := io.ReadAll(r.Body)
			if err != nil {
				next.ServeHTTP(w, r)
				return
			}
			r.Body.Close()

			var req struct {
				Identifier string `json:"identifier"`
				Cedula     string `json:"cedula"`
			}
			effective := ""
			if err := json.Unmarshal(body, &req); err == nil {
				effective = req.Identifier
				if effective == "" {
					effective = req.Cedula
				}
			}
			kind, canonical, cerr := identifier.Classify(effective)
			if effective == "" || cerr != nil {
				// Can't determine account - pass through and let handler validate
				r.Body = io.NopCloser(newBytesReader(body))
				next.ServeHTTP(w, r)
				return
			}

			count := store.GetLockout(identifier.LockoutKey(kind, canonical))
			if int(count) >= maxAttempts {
				response.Error(w, http.StatusLocked, "ACCOUNT_LOCKED",
					"account temporarily locked due to too many failed attempts")
				return
			}

			// Restore body for downstream handlers
			r.Body = io.NopCloser(newBytesReader(body))
			next.ServeHTTP(w, r)
		})
	}
}

// IncrementLockout increments the lockout counter for a canonical identifier.
// Call on failed login. El tipo forma parte de la clave: ver LockoutKey.
func IncrementLockout(store LockoutStore, kind identifier.Kind, canonical string) {
	store.IncrLockout(identifier.LockoutKey(kind, canonical))
}

// ResetLockoutCounter resets the lockout counter for a canonical identifier.
// Call on successful login.
func ResetLockoutCounter(store LockoutStore, kind identifier.Kind, canonical string) {
	store.ResetLockout(identifier.LockoutKey(kind, canonical))
}

type bytesReader struct {
	data []byte
	pos  int
}

func newBytesReader(data []byte) *bytesReader {
	return &bytesReader{data: data}
}

func (r *bytesReader) Read(p []byte) (int, error) {
	if r.pos >= len(r.data) {
		return 0, io.EOF
	}
	n := copy(p, r.data[r.pos:])
	r.pos += n
	return n, nil
}
