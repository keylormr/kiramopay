package payout

import (
	"context"
	"log/slog"
	"time"
)

// Poller periodically reconciles processing payouts against their rail,
// driving asynchronous settlements to a terminal state and self-healing any
// payout that crashed between its debit and its Send. It mirrors the
// reconciliation worker and webhook dispatcher: a simple ticker loop that
// exits when its context is cancelled.
type Poller struct {
	svc       *Service
	interval  time.Duration
	graceSecs int
	batch     int
	logger    *slog.Logger
}

// NewPoller wires the poller. interval defaults to 30s; the grace period (how
// long a payout must sit in processing before the poller touches it, avoiding a
// race with an in-flight synchronous submit) defaults to 60s; batch defaults to
// 100 payouts per tick.
func NewPoller(svc *Service, interval time.Duration, logger *slog.Logger) *Poller {
	if interval <= 0 {
		interval = 30 * time.Second
	}
	return &Poller{
		svc:       svc,
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

// tick reconciles one batch. Errors are logged, never fatal.
func (p *Poller) tick(ctx context.Context) {
	advanced, err := p.svc.reconcileStuck(ctx, p.graceSecs, p.batch)
	if err != nil {
		if p.logger != nil {
			p.logger.Error("payout poller tick failed", "error", err.Error())
		}
		return
	}
	if advanced > 0 && p.logger != nil {
		p.logger.Info("payout poller advanced settlements", "count", advanced)
	}
}
