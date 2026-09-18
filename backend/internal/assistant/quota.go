package assistant

import (
	"context"
	"fmt"
	"time"

	"github.com/kiramopay/backend/pkg/ventanaredis"
	"github.com/redis/go-redis/v9"
)

// QuotaResult is the outcome of a quota check. Scope names which budget was
// exhausted when Allowed is false: "user" (the caller's own daily plan limit)
// or "global" (the app-wide safety cap — not the user's fault).
type QuotaResult struct {
	Allowed bool
	Scope   string
}

// Limiter enforces the assistant's daily usage quota. A nil Limiter on the
// Service means unlimited (tests, and any deployment without Redis wired).
type Limiter interface {
	Allow(ctx context.Context, userID string) (QuotaResult, error)
	// Refund returns one consumed unit, called when a turn that passed Allow
	// ultimately fails so our own error doesn't burn the user's quota.
	Refund(ctx context.Context, userID string)
}

// PlanResolver returns the user's billing plan ("free"/"plus"/"pro"). On error
// the quota treats the user as "free" (the strictest tier), so a lookup failure
// never loosens the budget.
type PlanResolver func(ctx context.Context, userID string) (string, error)

// RedisQuota caps assistant turns per user per day (by billing plan) and across
// the whole app per day, so the paid model-API budget can't be drained.
// Counters are Redis keys scoped by UTC date with a 48h TTL (always outliving
// their day); a new day resets them by rolling to a fresh key.
type RedisQuota struct {
	rdb         *redis.Client
	planLimits  map[string]int // plan -> daily limit; must contain "free"
	globalLimit int
	planOf      PlanResolver     // nil ⇒ everyone treated as "free"
	clock       func() time.Time // injectable for tests
}

const quotaTTL = 48 * time.Hour

// NewRedisQuota builds the quota. planLimits maps plan -> daily limit; a missing
// or non-positive "free" entry falls back to 2. Non-positive globalLimit falls
// back to 100.
func NewRedisQuota(rdb *redis.Client, planLimits map[string]int, globalLimit int, planOf PlanResolver) *RedisQuota {
	limits := map[string]int{}
	for k, v := range planLimits {
		limits[k] = v
	}
	if limits["free"] <= 0 {
		limits["free"] = 2
	}
	if globalLimit <= 0 {
		globalLimit = 100
	}
	return &RedisQuota{rdb: rdb, planLimits: limits, globalLimit: globalLimit, planOf: planOf, clock: time.Now}
}

func (q *RedisQuota) day() string { return q.clock().UTC().Format("2006-01-02") }

func (q *RedisQuota) userKey(userID string) string {
	return fmt.Sprintf("assistant:q:user:%s:%s", userID, q.day())
}

func (q *RedisQuota) globalKey() string {
	return fmt.Sprintf("assistant:q:global:%s", q.day())
}

// limitFor resolves the caller's daily limit from their plan, defaulting to the
// free tier on any unknown plan or resolver error.
func (q *RedisQuota) limitFor(ctx context.Context, userID string) int {
	plan := "free"
	if q.planOf != nil {
		if p, err := q.planOf(ctx, userID); err == nil && p != "" {
			plan = p
		}
	}
	return q.LimiteDelPlan(plan)
}

// LimiteDelPlan es el tope diario que se aplica a un plan, con la misma regla
// que la cuota: un plan sin limite positivo recibe el del gratuito. Lo usa
// tambien /transparency/fees, para publicar exactamente el numero que se
// aplica y no una copia de la configuracion.
func (q *RedisQuota) LimiteDelPlan(plan string) int {
	if lim := q.planLimits[plan]; lim > 0 {
		return lim
	}
	return q.planLimits["free"]
}

// incr suma uno al contador y le garantiza vencimiento en la MISMA orden.
//
// Eran dos —INCR y, si el contador quedaba en 1, EXPIRE— con una ventana entre
// ellas: si el proceso moria justo ahi (un despliegue, un reinicio, un OOM) la
// llave quedaba sin vencimiento. Y una llave de cuota sin vencimiento no es
// "un dia de mas": el contador del dia sigue subiendo para siempre, asi que en
// cuanto pasa el tope esa persona se queda sin asistente definitivamente, o
// —si es la global— se queda sin asistente la aplicacion entera. El comentario
// viejo decia que un expire perdido solo dejaba la llave un dia de mas; no era
// cierto, porque la llave que no vence tampoco se recicla al cambiar el dia.
//
// El guion repara ademas las llaves que ya hubieran quedado sin vencimiento,
// incluidas las que crea un Refund que cruza la medianoche (ver Refund).
func (q *RedisQuota) incr(ctx context.Context, key string) (int64, error) {
	return ventanaredis.Contar(ctx, q.rdb, key, quotaTTL)
}

// restar devuelve una unidad al contador SIN poder crearlo.
//
// Era un DECR pelado, que a la llave que no encuentra la crea en -1 y sin
// vencimiento (ver ventanaredis.Restar): el mismo defecto que se cerro en el
// camino de contar, entrando por la puerta de atras. El error se ignora a
// proposito —devolver es best-effort— y por eso el resultado tampoco se mira.
func (q *RedisQuota) restar(ctx context.Context, key string) {
	_, _ = ventanaredis.Restar(ctx, q.rdb, key)
}

// Allow consumes one unit from both the per-user (plan-sized) and global daily
// budgets. On any over-limit it rolls back its own increments so a blocked
// attempt doesn't inflate the counters, and reports which budget was hit. A
// Redis error returns (_, err) so the caller fails closed and protects budget.
func (q *RedisQuota) Allow(ctx context.Context, userID string) (QuotaResult, error) {
	userLimit := q.limitFor(ctx, userID)

	uKey := q.userKey(userID)
	uN, err := q.incr(ctx, uKey)
	if err != nil {
		return QuotaResult{}, err
	}
	if uN > int64(userLimit) {
		q.restar(ctx, uKey)
		return QuotaResult{Allowed: false, Scope: "user"}, nil
	}
	gKey := q.globalKey()
	gN, err := q.incr(ctx, gKey)
	if err != nil {
		q.restar(ctx, uKey) // undo the user increment already made this call
		return QuotaResult{}, err
	}
	if gN > int64(q.globalLimit) {
		q.restar(ctx, gKey)
		q.restar(ctx, uKey)
		return QuotaResult{Allowed: false, Scope: "global"}, nil
	}
	return QuotaResult{Allowed: true}, nil
}

// Refund devuelve una unidad a los dos presupuestos. Es best-effort: una
// devolucion perdida deja el cupo del dia un poco mas estricto, nunca mas
// flojo. Con DECR eso no era cierto, en dos sentidos a la vez.
//
// Un turno que empieza antes de la medianoche UTC y falla despues devuelve la
// unidad a las llaves del dia SIGUIENTE, que todavia no existen —el dia se
// recalcula aqui, no se hereda del Allow—, y DECR no devuelve nada: las CREA en
// -1 y sin vencimiento. Lo mismo cuando la llave se perdio por una eviccion.
// Quedaban entonces una llave eterna en Redis y, al dia siguiente, un contador
// que arranca en negativo, o sea un turno de regalo por encima del plan.
//
// Se confiaba en que el primer Contar del dia le devolviera el vencimiento,
// pero eso solo pasa si esa persona vuelve a escribirle al asistente ese mismo
// dia; a la llave de quien no vuelve no la toca nadie. ventanaredis.Restar no
// crea la llave que no encuentra, asi que la devolucion que no tiene a quien
// devolverle se pierde — que es justo lo que esta politica declara.
func (q *RedisQuota) Refund(ctx context.Context, userID string) {
	q.restar(ctx, q.userKey(userID))
	q.restar(ctx, q.globalKey())
}
