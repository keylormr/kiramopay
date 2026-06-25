package payout

import (
	"context"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/kiramopay/backend/internal/cluster"
)

// Poller periodically reconciles processing payouts against their rail,
// driving asynchronous settlements to a terminal state and self-healing any
// payout that crashed between its debit and its Send. It mirrors the
// reconciliation worker and webhook dispatcher: a simple ticker loop that
// exits when its context is cancelled. Each tick runs under a cluster-wide
// advisory lock so that, with the API scaled to multiple instances, only one
// re-dispatches a given batch of stuck payouts.
type Poller struct {
	svc       *Service
	pool      *pgxpool.Pool
	interval  time.Duration
	graceSecs int
	batch     int
	logger    *slog.Logger
}

// NewPoller wires the poller. pool is used only for the cluster-wide leader
// lock. interval defaults to 30s; the grace period (how long a payout must sit
// in processing before the poller touches it, avoiding a race with an in-flight
// synchronous submit) defaults to 60s; batch defaults to 100 payouts per tick.
func NewPoller(svc *Service, pool *pgxpool.Pool, interval time.Duration, logger *slog.Logger) *Poller {
	if interval <= 0 {
		interval = 30 * time.Second
	}
	return &Poller{
		svc:       svc,
		pool:      pool,
		interval:  interval,
		graceSecs: 60,
		batch:     100,
		logger:    logger,
	}
}

// WithGrace overrides the grace period (mainly for tests).
func (p *Poller) WithGrace(d time.Duration) *Poller {
	p.graceSecs = int(d.Seconds())
	return p
}

// Run blocks until ctx is cancelled, reconciling on each tick.
func (p *Poller) Run(ctx context.Context) {
	ticker := time.NewTicker(p.interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			p.tick(ctx)
		}
	}
}

// tick reconciles one batch under the cluster-wide leader lock, so concurrent
// instances do not re-dispatch the same stuck payouts. Errors are logged, never
// fatal; a tick skipped because another instance holds the lock is a no-op.
func (p *Poller) tick(ctx context.Context) {
	ran, err := cluster.TryRunExclusive(ctx, p.pool, cluster.KeyPayoutPoller, func(c context.Context) error {
		advanced, rerr := p.svc.reconcileStuck(c, p.graceSecs, p.batch)
		if rerr != nil {
			return rerr
		}
		if advanced > 0 && p.logger != nil {
			p.logger.Info("payout poller advanced settlements", "count", advanced)
		}
		return nil
	})
	if err != nil {
		if p.logger != nil {
			p.logger.Error("payout poller tick failed", "error", err.Error())
		}
		return
	}
	if !ran && p.logger != nil {
		p.logger.Debug("payout poller tick skipped; another instance is leader")
	}
}
