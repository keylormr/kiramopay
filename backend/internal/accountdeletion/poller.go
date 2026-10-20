package accountdeletion

import (
	"context"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kiramopay/backend/internal/cluster"
)

// Poller corre los barridos de la linea de tiempo: el cierre de las cuentas cuyo
// dia 30 ya llego, la desasociacion de lo conservado cuyo plazo vencio, y la
// bandeja de las respuestas escritas que no salieron en el primer intento.
//
// Misma forma que el barrido de vencimientos (adminusers.Poller): un ticker que
// muere con su contexto, sin error fatal, y cada tick bajo el lock de cluster
// para que con la API escalada solo una instancia trate un mismo lote. Las tres
// operaciones son idempotentes: una pasada que se repite no hace nada (la
// bandeja, ademas, reserva cada respuesta antes de mandarla).
type Poller struct {
	svc      *Service
	pool     *pgxpool.Pool
	interval time.Duration
	batch    int
	logger   *slog.Logger
}

// NewPoller cablea el barrido. pool se usa solo para el lock de lider.
// interval por defecto 5 minutos (el plazo se mide en dias); batch, 100
// cuentas por tick y por barrido.
func NewPoller(svc *Service, pool *pgxpool.Pool, interval time.Duration, logger *slog.Logger) *Poller {
	if interval <= 0 {
		interval = 5 * time.Minute
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
	ran, err := cluster.TryRunExclusive(ctx, p.pool, cluster.KeyAccountDeletion, func(c context.Context) error {
		now := time.Now()
		cerradas, errCierre := p.svc.CerrarVencidas(c, now, p.batch)
		if cerradas > 0 && p.logger != nil {
			p.logger.Info("cuentas cerradas al vencer el plazo", "count", cerradas)
		}
		// La desasociacion corre aunque el cierre haya fallado en alguna cuenta:
		// son independientes. Se reporta el primer error.
		desasociadas, errDesasociar := p.svc.DesasociarVencidas(c, now, p.batch)
		if desasociadas > 0 && p.logger != nil {
			p.logger.Info("cuentas desasociadas al vencer la conservacion", "count", desasociadas)
		}
		// Las respuestas escritas que no salieron en el primer intento.
		entregadas, errEntrega := p.svc.EntregarRespuestas(c, now, p.batch)
		if entregadas > 0 && p.logger != nil {
			p.logger.Info("respuestas escritas entregadas por el barrido", "count", entregadas)
		}
		if errCierre != nil {
			return errCierre
		}
		if errDesasociar != nil {
			return errDesasociar
		}
		return errEntrega
	})
	if err != nil {
		if p.logger != nil {
			p.logger.Warn("barrido de eliminacion de cuentas fallido", "error", err)
		}
		return
	}
	if !ran && p.logger != nil {
		p.logger.Debug("barrido de eliminacion omitido; otra instancia es lider")
	}
}
