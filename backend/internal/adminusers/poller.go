package adminusers

import (
	"context"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kiramopay/backend/internal/cluster"
)

// Poller cierra las cuentas cuyo vencimiento ya paso. Es el ejecutor de
// users.expires_at: mientras la fecha no llega la cuenta es una cuenta normal,
// y al llegar este barrido la bloquea por el mismo camino que un bloqueo manual
// (Service.ExpireDue -> enforceBlock).
//
// Misma forma que los otros barridos del proceso (payout, escrow, reconcile):
// un ticker que muere con su contexto, sin error fatal, y cada tick bajo el
// lock de cluster para que con la API escalada solo una instancia bloquee un
// mismo lote de cuentas vencidas.
type Poller struct {
	svc      *Service
	pool     *pgxpool.Pool
	interval time.Duration
	batch    int
	logger   *slog.Logger
}

// NewPoller cablea el barrido. pool se usa solo para el lock de lider.
// interval por defecto 60s; batch por defecto 100 cuentas por tick.
func NewPoller(svc *Service, pool *pgxpool.Pool, interval time.Duration, logger *slog.Logger) *Poller {
	if interval <= 0 {
		interval = 60 * time.Second
	}
	return &Poller{svc: svc, pool: pool, interval: interval, batch: 100, logger: logger}
}

// Run bloquea hasta que se cancele ctx, barriendo en cada tick.
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
	ran, err := cluster.TryRunExclusive(ctx, p.pool, cluster.KeyDemoExpiry, func(c context.Context) error {
		n, rerr := p.svc.ExpireDue(c, time.Now(), p.batch)
		if n > 0 && p.logger != nil {
			p.logger.Info("cuentas vencidas bloqueadas", "count", n)
		}
		return rerr
	})
	if err != nil {
		if p.logger != nil {
			p.logger.Warn("barrido de vencimientos fallido", "error", err)
		}
		return
	}
	if !ran && p.logger != nil {
		p.logger.Debug("barrido de vencimientos omitido; otra instancia es lider")
	}
}
