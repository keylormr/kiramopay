package crypto

import (
	"context"
	"fmt"
	"log/slog"
	"sort"
	"sync"
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
// Cuatro reglas lo definen:
//
//   - El precio sale del cache. Un precio vencido (mismo corte que GetPrice) no
//     decide nada; si ningun activo tiene precio vigente, la vuelta normal ni
//     siquiera pide el candado, para que otra instancia con precios al dia
//     pueda tomarlo.
//   - El barrido garantiza su propio avance. El cache lo refresca el
//     broadcaster del WebSocket, que solo corre mientras alguien tiene la app
//     abierta: sin nadie conectado el cache se vencia y una alerta podia no
//     cumplirse nunca. Por eso, con el cache vencido y pasado `refrescoCada`,
//     la vuelta gasta UNA llamada al proveedor (PriceService.RefrescarPrecios,
//     el mismo camino de siempre) y recien entonces evalua. Con el cache al dia
//     no gasta nada. `refrescoCada` en 0 apaga el refresco propio.
//   - Una vez por alerta. Con la API escalada, cada vuelta corre bajo el
//     candado de cluster, y ademas marcar y elegir son una sola sentencia
//     (Repository.CumplirAlertas): aunque dos instancias coincidieran, cada
//     alerta pasa a cumplida una sola vez. El refresco tambien va DENTRO del
//     candado, para que dos instancias no gasten dos llamadas por el mismo
//     intervalo.
//   - El aviso va DESPUES de marcar. Si el proceso cae entre las dos cosas, la
//     alerta queda cumplida sin aviso (se ve en la pantalla, con su fecha y su
//     precio); al reves podria avisar dos veces, y un aviso no se deshace.
//
// Costo de cuota del refresco propio: con `refrescoCada` en 1 hora son ~720
// llamadas al mes de las 10.000 de la clave Demo de CoinGecko, y el techo de
// gasto lo sigue marcando el broadcaster, que pide precios cada 15 segundos
// mientras haya alguien conectado. Cuando se pague el plan Pro, el cache baja
// a 30 segundos y este refresco se vuelve casi siempre innecesario: ahi toca
// revisar si sigue valiendo la pena o si conviene bajarlo a minutos.
type EvaluadorDeAlertas struct {
	precios      fuenteDePrecios
	alertas      almacenDeAlertas
	avisos       Notifier
	candado      func(ctx context.Context, fn func(context.Context) error) (bool, error)
	intervalo    time.Duration
	refrescoCada time.Duration
	lote         int
	logger       *slog.Logger
	ahora        func() time.Time

	// mu protege las dos marcas de tiempo. vuelta corre en una sola goroutine,
	// pero UltimaRevision la lee el handler de /health desde otra.
	mu             sync.Mutex
	ultimoRefresco time.Time
	ultimaRevision time.Time
}

// Notifier avisa a una persona dentro de la app y en sus telefonos y
// navegadores suscritos. Lo satisface *notification.Service, el mismo que usan
// sinpe, escrow y los cobros QR.
type Notifier interface {
	NotifyUser(ctx context.Context, userID, title, body, tag string) error
}

// fuenteDePrecios es lo que el barrido necesita de PriceService: leer lo que ya
// hay (gratis) y, cuando no hay nada al dia, traerlo (una llamada).
type fuenteDePrecios interface {
	PreciosVigentes() map[string]decimal.Decimal
	RefrescarPrecios(ctx context.Context) error
}

type almacenDeAlertas interface {
	CumplirAlertas(ctx context.Context, activo string, precio decimal.Decimal, limite int) ([]PriceAlertRecord, error)
}

// EtiquetaAvisoDeAlerta es el tipo con que el aviso queda en el historial de
// notificaciones (la pantalla le pone su icono).
const EtiquetaAvisoDeAlerta = "price_alert"

// NuevoEvaluadorDeAlertas cablea el barrido. pool se usa solo para el candado
// de cluster; las alertas se leen y marcan por el repositorio.
//
// refrescoCada es cada cuanto puede gastar una llamada al proveedor cuando el
// cache esta vencido (ALERTAS_REFRESCO_HORAS); 0 apaga ese refresco.
func NuevoEvaluadorDeAlertas(repo *Repository, precios *PriceService, avisos Notifier,
	pool *pgxpool.Pool, intervalo, refrescoCada time.Duration, logger *slog.Logger) *EvaluadorDeAlertas {
	return nuevoEvaluador(precios, repo, avisos,
		func(ctx context.Context, fn func(context.Context) error) (bool, error) {
			return cluster.TryRunExclusive(ctx, pool, cluster.KeyPriceAlerts, fn)
		}, intervalo, refrescoCada, logger)
}

func nuevoEvaluador(precios fuenteDePrecios, alertas almacenDeAlertas, avisos Notifier,
	candado func(context.Context, func(context.Context) error) (bool, error),
	intervalo, refrescoCada time.Duration, logger *slog.Logger) *EvaluadorDeAlertas {
	if intervalo <= 0 {
		intervalo = time.Minute
	}
	// Un refresco mas seguido que el propio barrido no existe: la vuelta es la
	// unica que lo dispara.
	if refrescoCada > 0 && refrescoCada < intervalo {
		refrescoCada = intervalo
	}
	if logger == nil {
		logger = slog.Default()
	}
	return &EvaluadorDeAlertas{
		precios:      precios,
		alertas:      alertas,
		avisos:       avisos,
		candado:      candado,
		intervalo:    intervalo,
		refrescoCada: refrescoCada,
		lote:         500,
		logger:       logger,
		ahora:        time.Now,
	}
}

// RefrescoCada devuelve el intervalo de refresco propio que quedo vigente
// (0 = apagado). El arranque lo escribe en el log: la variable dice una cosa y
// lo que corre puede ser otra si el valor no era usable.
func (e *EvaluadorDeAlertas) RefrescoCada() time.Duration { return e.refrescoCada }

// UltimaRevision devuelve cuando el barrido comparo por ultima vez las alertas
// contra un precio vigente, o el cero si todavia no pudo. La lee /health.
func (e *EvaluadorDeAlertas) UltimaRevision() time.Time {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.ultimaRevision
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
	// Sin precios vigentes no hay nada que decidir; la vuelta solo insiste
	// cuando le toca traerlos ella misma. Si no le toca, ni pide el candado:
	// queda libre para una instancia que si tenga precios al dia.
	if len(precios) == 0 && !e.tocaRefrescar() {
		e.logger.Debug("alertas de precio: sin precios vigentes, no se evalua")
		return 0
	}

	cumplidas := 0
	corrio, err := e.candado(ctx, func(c context.Context) error {
		if len(precios) == 0 {
			// El refresco va DENTRO del candado: con la API escalada, una sola
			// instancia gasta la llamada de este intervalo.
			e.refrescar(c)
			precios = e.precios.PreciosVigentes()
			if len(precios) == 0 {
				// El proveedor no dejo nada usable. La vuelta termina aqui sin
				// tocar ninguna alerta: no queda a medias, y el intervalo ya
				// quedo consumido, asi que no se martillea al proveedor.
				return nil
			}
		}
		var err error
		cumplidas, err = e.evaluar(c, precios)
		e.marcarRevision()
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

// tocaRefrescar dice si a esta vuelta le toca gastar la llamada del intervalo.
// Solo lee: la marca se pone al refrescar de verdad, ya bajo el candado, para
// que perder el candado no consuma el intervalo sin haber traido nada.
func (e *EvaluadorDeAlertas) tocaRefrescar() bool {
	if e.precios == nil || e.refrescoCada <= 0 {
		return false
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	// La primera vuelta tras arrancar refresca: el cache nace vacio y, sin
	// nadie conectado, nadie mas lo va a llenar.
	return e.ultimoRefresco.IsZero() || e.ahora().Sub(e.ultimoRefresco) >= e.refrescoCada
}

// refrescar gasta la llamada del intervalo. El intento se apunta PASE LO QUE
// PASE: un proveedor caido no puede convertir el barrido en una llamada por
// minuto, que es como se quema una cuota mensual en un dia.
func (e *EvaluadorDeAlertas) refrescar(ctx context.Context) {
	e.mu.Lock()
	e.ultimoRefresco = e.ahora()
	e.mu.Unlock()
	if err := e.precios.RefrescarPrecios(ctx); err != nil {
		e.logger.Warn("alertas de precio: el refresco propio no trajo precios",
			"error", err, "proximo_intento_en", e.refrescoCada)
		return
	}
	e.logger.Info("alertas de precio: precios refrescados por el barrido", "cada", e.refrescoCada)
}

// marcarRevision deja constancia de que las alertas si se compararon contra un
// precio vigente. Lo publica /health.
func (e *EvaluadorDeAlertas) marcarRevision() {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.ultimaRevision = e.ahora()
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
