package assistant

import (
	"context"
	"fmt"
	"time"

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
	if lim := q.planLimits[plan]; lim > 0 {
		return lim
	}
	return q.planLimits["free"]
}

// incr bumps a counter and sets its TTL on first creation.
func (q *RedisQuota) incr(ctx context.Context, key string) (int64, error) {
	n, err := q.rdb.Incr(ctx, key).Result()
	if err != nil {
		return 0, err
	}
	if n == 1 {
		// Best-effort TTL; a lost expire only lets the key linger one extra day.
		_ = q.rdb.Expire(ctx, key, quotaTTL).Err()
	}
	return n, nil
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
		q.rdb.Decr(ctx, uKey)
		return QuotaResult{Allowed: false, Scope: "user"}, nil
	}
	gKey := q.globalKey()
	gN, err := q.incr(ctx, gKey)
	if err != nil {
		q.rdb.Decr(ctx, uKey) // undo the user increment already made this call
		return QuotaResult{}, err
	}
	if gN > int64(q.globalLimit) {
		q.rdb.Decr(ctx, gKey)
		q.rdb.Decr(ctx, uKey)
		return QuotaResult{Allowed: false, Scope: "global"}, nil
	}
	return QuotaResult{Allowed: true}, nil
}

// Refund returns one unit to both budgets. Best-effort: a lost decrement only
// makes the day's limit slightly stricter, never looser. Both keys were created
// (with a TTL) by the matching Allow in the same request, so Decr never orphans
// a TTL-less key.
func (q *RedisQuota) Refund(ctx context.Context, userID string) {
	q.rdb.Decr(ctx, q.userKey(userID))
	q.rdb.Decr(ctx, q.globalKey())
}
