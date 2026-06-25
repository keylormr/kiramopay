package escrow

import (
	"context"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/kiramopay/backend/internal/cluster"
)

// Poller periodically re-drives escrow agreements whose money movement was left
// unconfirmed (release/refund posting failed and its compensating revert also
// failed). It mirrors the payout settlement poller and the webhook dispatcher:
// a simple ticker loop that exits when its context is cancelled. Each tick runs
// under a cluster-wide advisory lock so that, with the API scaled to multiple
// instances, only one re-drives a given batch of stuck agreements.
type Poller struct {
	svc      *Service
	pool     *pgxpool.Pool
	interval time.Duration
	batch    int
	logger   *slog.Logger
}

// NewPoller wires the poller. pool is used only for the cluster-wide leader
// lock. interval defaults to 60s; batch defaults to 100 agreements per tick.
func NewPoller(svc *Service, pool *pgxpool.Pool, interval time.Duration, logger *slog.Logger) *Poller {
	if interval <= 0 {
		interval = 60 * time.Second
	}
	return &Poller{svc: svc, pool: pool, interval: interval, batch: 100, logger: logger}
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

func (p *Poller) tick(ctx context.Context) {
	ran, err := cluster.TryRunExclusive(ctx, p.pool, cluster.KeyEscrowPoller, func(c context.Context) error {
		n, rerr := p.svc.ReconcileStuck(c, p.batch)
		if rerr != nil {
			return rerr
		}
		if n > 0 && p.logger != nil {
			p.logger.Info("escrow reconcile re-drove stuck settlements", "count", n)
		}
		return nil
	})
	if err != nil {
		if p.logger != nil {
			p.logger.Warn("escrow reconcile failed", "error", err)
		}
		return
	}
	if !ran && p.logger != nil {
		p.logger.Debug("escrow reconcile skipped; another instance is leader")
	}
}
