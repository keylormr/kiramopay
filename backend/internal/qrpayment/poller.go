package qrpayment

import (
	"context"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kiramopay/backend/internal/cluster"
)

// loteLightning: facturas Lightning consultadas por pasada del barrido.
const loteLightning = 25

// Poller marca vencidos los cobros pendientes cuyo plazo paso.
//
// Es COSMETICO para la correctitud, y conviene decirlo para que nadie lo trate
// como una guarda: el reclamo del cobro filtra por `expires_at > NOW()` DENTRO
// de la transaccion del asiento, asi que un cobro vencido no cobra aunque este
// barrido se atrase o no corra nunca. Lo que arregla es que la pantalla del
// cajero y la lista de pedidos digan la verdad en vez de mostrar como "esperando
// pago" algo que ya no se puede pagar.
//
// Misma forma que los otros barridos del proceso (payout, escrow, vencimiento de
// cuentas): un ticker que muere con su contexto, sin error fatal, y cada tick
// bajo el lock de cluster para que con la API escalada solo una instancia barra
// un mismo lote.
type Poller struct {
	svc      *Service
	pool     *pgxpool.Pool
	interval time.Duration
	batch    int
	logger   *slog.Logger
}

// NewPoller cablea el barrido. pool se usa solo para el lock de lider.
func NewPoller(svc *Service, pool *pgxpool.Pool, interval time.Duration, logger *slog.Logger) *Poller {
	if interval <= 0 {
		interval = 60 * time.Second
	}
	return &Poller{svc: svc, pool: pool, interval: interval, batch: 500, logger: logger}
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
	ran, err := cluster.TryRunExclusive(ctx, p.pool, cluster.KeyQRCharges, func(c context.Context) error {
		// Primero las facturas Lightning: una pagada en el ultimo minuto marca
		// su cobro pagado antes de que el barrido de abajo lo de por vencido.
		// Un fallo aqui no detiene el barrido de los cobros.
		// Cada consulta espera al proveedor hasta 8 s: el lote es chico para
		// que el barrido no retenga el lock de cluster por minutos.
		revisadas, vencidas, lerr := p.svc.RevisarLightningPendientes(c, loteLightning)
		if lerr != nil && p.logger != nil {
			p.logger.Error("facturas lightning: barrido fallido", "error", lerr)
		} else if (revisadas > 0 || vencidas > 0) && p.logger != nil {
			p.logger.Info("facturas lightning revisadas", "revisadas", revisadas, "vencidas", vencidas)
		}
		n, rerr := p.svc.repo.ExpirarCobrosVencidos(c, p.batch)
		if n > 0 && p.logger != nil {
			p.logger.Info("cobros QR vencidos", "count", n)
		}
		return rerr
	})
	if err != nil {
		if p.logger != nil {
			p.logger.Warn("barrido de cobros QR fallido", "error", err)
		}
		return
	}
	if !ran && p.logger != nil {
		p.logger.Debug("barrido de cobros QR omitido; otra instancia es lider")
	}
}
