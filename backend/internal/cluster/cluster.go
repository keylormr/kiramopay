// Package cluster provides cross-instance coordination so that periodic
// "scan everything" workers stay single-flight when the API runs as more than
// one instance (e.g. horizontal scaling on Render).
//
// Workers that drain a per-row outbox (the webhook dispatcher) already
// cooperate safely via `FOR UPDATE SKIP LOCKED` leases and do NOT need this.
// Workers that sweep the whole table on each tick (reconcile, payout poller,
// escrow poller) would otherwise repeat the same survey on every instance:
// redundant work, duplicate audit/alert events, and redundant rail calls. They
// gate each tick through TryRunExclusive so only one instance runs it.
//
// The mechanism is a PostgreSQL session-level advisory lock acquired
// non-blockingly with pg_try_advisory_lock: whichever instance grabs the lock
// runs the tick; the others skip it until the next tick. This is leader
// election *per tick*, not a sticky leader — it is stateless, needs no lease
// table or heartbeat, and self-heals if the holder dies (its session ends and
// PostgreSQL drops the lock, so the next tick any instance can take over). It
// mirrors the session advisory-lock pattern already used in
// internal/sinpe.AcquireUserSendLock.
package cluster

import (
	"context"
	"fmt"
	"hash/fnv"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Advisory-lock keys for the cluster-wide singleton workers. They are derived
// from stable namespace strings so the values are documented by their source
// here and cannot silently collide: each distinct string yields a distinct
// key, and they cannot clash with the per-user sinpe keys (those always carry a
// UUID suffix, so their hash inputs never equal these bare namespaces).
var (
	KeyReconcile    = lockKey("worker:reconcile")
	KeyPayoutPoller = lockKey("worker:payout-poller")
	KeyEscrowPoller = lockKey("worker:escrow-poller")
)

// lockKey derives a stable int64 advisory-lock key from a namespace string.
func lockKey(namespace string) int64 {
	h := fnv.New64a()
	_, _ = h.Write([]byte(namespace))
	return int64(h.Sum64()) // #nosec G115 -- advisory-lock key; any int64 value (incl. negative) is valid for pg_advisory_lock
}

// TryRunExclusive runs fn at most once across the cluster for the given key.
//
// It acquires a non-blocking session-level advisory lock on a dedicated pooled
// connection. If the lock is free it runs fn while holding it and returns
// (true, fnErr). If another instance already holds it, fn is skipped and it
// returns (false, nil). The lock is held on the dedicated connection for fn's
// entire duration — fn uses the pool independently for its own queries, exactly
// as sinpe.Service.Send runs under AcquireUserSendLock — so two instances never
// execute fn concurrently.
//
// The lock is released explicitly before the connection returns to the pool;
// if the process crashes mid-run the connection drops and PostgreSQL releases
// the lock when the session ends, so a crashed leader never wedges the worker.
func TryRunExclusive(ctx context.Context, pool *pgxpool.Pool, key int64, fn func(context.Context) error) (bool, error) {
	conn, err := pool.Acquire(ctx)
	if err != nil {
		return false, fmt.Errorf("cluster: acquire conn: %w", err)
	}
	defer conn.Release()

	var acquired bool
	if err := conn.QueryRow(ctx, `SELECT pg_try_advisory_lock($1)`, key).Scan(&acquired); err != nil {
		return false, fmt.Errorf("cluster: try advisory lock: %w", err)
	}
	if !acquired {
		return false, nil
	}
	defer func() {
		// Best-effort unlock on a detached context so it runs even if ctx was
		// cancelled mid-tick. If it ever fails, PostgreSQL still drops the lock
		// once this pooled connection is closed.
		_, _ = conn.Exec(context.Background(), `SELECT pg_advisory_unlock($1)`, key)
	}()

	return true, fn(ctx)
}
