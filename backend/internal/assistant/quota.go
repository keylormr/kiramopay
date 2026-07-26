package assistant

import (
	"context"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

// Limiter enforces the assistant's daily usage quota. A nil Limiter on the
// Service means unlimited (tests, and any deployment without Redis wired).
type Limiter interface {
	// Allow consumes one unit from the caller's daily budget. It returns
	// (true, nil) only when the turn is within both the per-user and global
	// limits. (false, nil) means over limit; a non-nil error means the backing
	// store failed and the caller should fail closed.
	Allow(ctx context.Context, userID string) (bool, error)
	// Refund returns one consumed unit, called when a turn that passed Allow
	// ultimately fails so our own error doesn't burn the user's quota.
	Refund(ctx context.Context, userID string)
}

// RedisQuota caps assistant turns per user per day and across the whole app per
// day, so the paid model-API budget can't be drained. Counters are Redis keys
// scoped by UTC date with a 48h TTL (always outliving their day); a new day
// resets them by rolling to a fresh key.
type RedisQuota struct {
	rdb         *redis.Client
	userLimit   int
	globalLimit int
	clock       func() time.Time // injectable for tests
}

const quotaTTL = 48 * time.Hour

// NewRedisQuota builds the quota. Non-positive limits fall back to sane
// defaults (2 per user/day, 100 app-wide/day).
func NewRedisQuota(rdb *redis.Client, userLimit, globalLimit int) *RedisQuota {
	if userLimit <= 0 {
		userLimit = 2
	}
	if globalLimit <= 0 {
		globalLimit = 100
	}
	return &RedisQuota{rdb: rdb, userLimit: userLimit, globalLimit: globalLimit, clock: time.Now}
}

func (q *RedisQuota) day() string { return q.clock().UTC().Format("2006-01-02") }

func (q *RedisQuota) userKey(userID string) string {
	return fmt.Sprintf("assistant:q:user:%s:%s", userID, q.day())
}

func (q *RedisQuota) globalKey() string {
	return fmt.Sprintf("assistant:q:global:%s", q.day())
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

// Allow consumes one unit from both the per-user and global daily budgets. On
// any over-limit it rolls back its own increments so a blocked attempt doesn't
// inflate the counters. A Redis error returns (false, err) so the caller fails
// closed and protects the budget.
func (q *RedisQuota) Allow(ctx context.Context, userID string) (bool, error) {
	uKey := q.userKey(userID)
	uN, err := q.incr(ctx, uKey)
	if err != nil {
		return false, err
	}
	if uN > int64(q.userLimit) {
		q.rdb.Decr(ctx, uKey)
		return false, nil
	}
	gKey := q.globalKey()
	gN, err := q.incr(ctx, gKey)
	if err != nil {
		q.rdb.Decr(ctx, uKey) // undo the user increment already made this call
		return false, err
	}
	if gN > int64(q.globalLimit) {
		q.rdb.Decr(ctx, gKey)
		q.rdb.Decr(ctx, uKey)
		return false, nil
	}
	return true, nil
}

// Refund returns one unit to both budgets. Best-effort: a lost decrement only
// makes the day's limit slightly stricter, never looser. Both keys were created
// (with a TTL) by the matching Allow in the same request, so Decr never orphans
// a TTL-less key.
func (q *RedisQuota) Refund(ctx context.Context, userID string) {
	q.rdb.Decr(ctx, q.userKey(userID))
	q.rdb.Decr(ctx, q.globalKey())
}
