package crypto

import (
	"context"
	"fmt"
	"log/slog"
	"sort"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/kiramopay/backend/internal/cluster"
	"github.com/shopspring/decimal"
)

// EvaluadorDeAlertas cumple las alertas de precio y avisa a sus duenos.
//
// Las alertas se guardaban desde la migracion 004 y ningun proceso las miraba:
// una alerta creada no se cumplia nunca. Este barrido corre cada `intervalo`
// y, por cada activo con un precio vigente, marca las alertas que ese precio
// satisface y avisa.
//
// Tres reglas lo definen:
//
//   - Precio SOLO del cache. No llama al proveedor: la clave Demo de CoinGecko
//     tiene 10.000 llamadas al mes y el broadcaster ya las administra. Un
//     precio vencido (mismo corte que GetPrice) no decide nada; si ningun
//     activo tiene precio vigente, la vuelta ni siquiera pide el candado, para
//     que otra instancia con precios al dia pueda tomarlo.
//   - Una vez por alerta. Con la API escalada, cada vuelta corre bajo el
//     candado de cluster, y ademas marcar y elegir son una sola sentencia
//     (Repository.CumplirAlertas): aunque dos instancias coincidieran, cada
//     alerta pasa a cumplida una sola vez.
//   - El aviso va DESPUES de marcar. Si el proceso cae entre las dos cosas, la
//     alerta queda cumplida sin aviso (se ve en la pantalla, con su fecha y su
//     precio); al reves podria avisar dos veces, y un aviso no se deshace.
type EvaluadorDeAlertas struct {
	precios   fuenteDePreciosVigentes
	alertas   almacenDeAlertas
	avisos    Notifier
	candado   func(ctx context.Context, fn func(context.Context) error) (bool, error)
	intervalo time.Duration
	lote      int
	logger    *slog.Logger
}

// Notifier avisa a una persona dentro de la app y en sus telefonos y
// navegadores suscritos. Lo satisface *notification.Service, el mismo que usan
// sinpe, escrow y los cobros QR.
type Notifier interface {
	NotifyUser(ctx context.Context, userID, title, body, tag string) error
}

type fuenteDePreciosVigentes interface {
	PreciosVigentes() map[string]decimal.Decimal
}

type almacenDeAlertas interface {
	CumplirAlertas(ctx context.Context, activo string, precio decimal.Decimal, limite int) ([]PriceAlertRecord, error)
}

// EtiquetaAvisoDeAlerta es el tipo con que el aviso queda en el historial de
// notificaciones (la pantalla le pone su icono).
const EtiquetaAvisoDeAlerta = "price_alert"

// NuevoEvaluadorDeAlertas cablea el barrido. pool se usa solo para el candado
// de cluster; las alertas se leen y marcan por el repositorio.
func NuevoEvaluadorDeAlertas(repo *Repository, precios *PriceService, avisos Notifier,
	pool *pgxpool.Pool, intervalo time.Duration, logger *slog.Logger) *EvaluadorDeAlertas {
	return nuevoEvaluador(precios, repo, avisos,
		func(ctx context.Context, fn func(context.Context) error) (bool, error) {
			return cluster.TryRunExclusive(ctx, pool, cluster.KeyPriceAlerts, fn)
		}, intervalo, logger)
}

func nuevoEvaluador(precios fuenteDePreciosVigentes, alertas almacenDeAlertas, avisos Notifier,
	candado func(context.Context, func(context.Context) error) (bool, error),
	intervalo time.Duration, logger *slog.Logger) *EvaluadorDeAlertas {
	if intervalo <= 0 {
		intervalo = time.Minute
	}
	if logger == nil {
		logger = slog.Default()
	}
	return &EvaluadorDeAlertas{
		precios:   precios,
		alertas:   alertas,
		avisos:    avisos,
		candado:   candado,
		intervalo: intervalo,
		lote:      500,
		logger:    logger,
	}
}

// Run bloquea hasta que se cancele ctx, evaluando en cada vuelta.
func (e *EvaluadorDeAlertas) Run(ctx context.Context) {
	ticker := time.NewTicker(e.intervalo)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			e.vuelta(ctx)
		}
	}
}

// vuelta es un tick del barrido. Devuelve cuantas alertas cumplio (para las
// pruebas y el log).
func (e *EvaluadorDeAlertas) vuelta(ctx context.Context) int {
	precios := e.precios.PreciosVigentes()
	if len(precios) == 0 {
		e.logger.Debug("alertas de precio: sin precios vigentes, no se evalua")
		return 0
	}
	cumplidas := 0
	corrio, err := e.candado(ctx, func(c context.Context) error {
		var err error
		cumplidas, err = e.evaluar(c, precios)
		return err
	})
	if err != nil {
		e.logger.Warn("barrido de alertas de precio fallido", "error", err, "cumplidas", cumplidas)
		return cumplidas
	}
	if !corrio {
		e.logger.Debug("barrido de alertas de precio omitido; otra instancia es lider")
		return 0
	}
	if cumplidas > 0 {
		e.logger.Info("alertas de precio cumplidas", "count", cumplidas)
	}
	return cumplidas
}

// evaluar recorre los activos en orden fijo (el log y las pruebas no dependen
// del orden de un mapa). Un activo que falla no frena a los demas.
func (e *EvaluadorDeAlertas) evaluar(ctx context.Context, precios map[string]decimal.Decimal) (int, error) {
	simbolos := make([]string, 0, len(precios))
	for s := range precios {
		simbolos = append(simbolos, s)
	}
	sort.Strings(simbolos)

	total := 0
	var primerError error
	for _, simbolo := range simbolos {
		cumplidas, err := e.alertas.CumplirAlertas(ctx, simbolo, precios[simbolo], e.lote)
		if err != nil {
			if primerError == nil {
				primerError = fmt.Errorf("cumplir alertas de %s: %w", simbolo, err)
			}
			continue
		}
		for i := range cumplidas {
			e.avisar(ctx, &cumplidas[i])
		}
		total += len(cumplidas)
	}
	return total, primerError
}

// avisar es best-effort: un aviso que no sale no deshace la alerta cumplida,
// que ya quedo en la pantalla con su fecha y su precio.
func (e *EvaluadorDeAlertas) avisar(ctx context.Context, a *PriceAlertRecord) {
	if e.avisos == nil {
		return
	}
	titulo, cuerpo := textoDelAviso(a)
	if err := e.avisos.NotifyUser(ctx, a.UserID, titulo, cuerpo, EtiquetaAvisoDeAlerta); err != nil {
		e.logger.Warn("aviso de alerta de precio fallido", "alerta", a.ID, "error", err)
	}
}

// textoDelAviso arma el aviso SIN montos: el mismo texto sale en la pantalla
// de bloqueo del telefono, y el precio objetivo dice cuanto piensa comprar o
// vender la persona. El precio y la fecha estan en la app, detras del acceso.
func textoDelAviso(a *PriceAlertRecord) (titulo, cuerpo string) {
	titulo = "Alerta de precio: " + a.Asset
	verbo := "subió"
	if a.Direction == "below" {
		verbo = "bajó"
	}
	cuerpo = fmt.Sprintf("%s %s a tu precio objetivo. Abre KiramoPay para ver el detalle.", a.Asset, verbo)
	return titulo, cuerpo
}
