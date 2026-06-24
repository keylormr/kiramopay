package escrow

import (
	"context"
	"log/slog"
	"time"
)

// Poller periodically re-drives escrow agreements whose money movement was left
// unconfirmed (release/refund posting failed and its compensating revert also
// failed). It mirrors the payout settlement poller and the webhook dispatcher:
// a simple ticker loop that exits when its context is cancelled.
type Poller struct {
	svc      *Service
	interval time.Duration
	batch    int
	logger   *slog.Logger
}

// NewPoller wires the poller. interval defaults to 60s; batch defaults to 100
// agreements per tick.
func NewPoller(svc *Service, interval time.Duration, logger *slog.Logger) *Poller {
	if interval <= 0 {
		interval = 60 * time.Second
	}
	return &Poller{svc: svc, interval: interval, batch: 100, logger: logger}
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
	n, err := p.svc.ReconcileStuck(ctx, p.batch)
	if err != nil {
		if p.logger != nil {
			p.logger.Warn("escrow reconcile failed", "error", err)
		}
		return
	}
	if n > 0 && p.logger != nil {
		p.logger.Info("escrow reconcile re-drove stuck settlements", "count", n)
	}
}
