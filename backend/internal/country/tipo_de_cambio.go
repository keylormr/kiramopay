package country

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"net/http"
	"sync"
	"time"
)

// El tipo de cambio estaba congelado en 515.
//
// La semilla (migracion 043) decia "approximate/manual" y el comentario del
// repositorio "updated at runtime", pero UpdateExchangeRate no tenia un solo
// llamador: USD/CRC quedo en 515 para siempre. El 2026-09-11 el oficial era
// 450,06 — cada compra o venta de cripto cotizada en colones se calculaba con
// un 14 % de desvio, y el "Total en USD" de la pantalla principal tambien.
//
// Ahora un actualizador lo trae de la fuente oficial y el camino que cobra se
// niega a usar un tipo de cambio que nadie confirmo hace demasiado.

// URLHacienda es el servicio publico del Ministerio de Hacienda que republica el
// tipo de cambio de referencia del BCCR. No pide registro ni token, a diferencia
// del web service del propio BCCR, que exige una suscripcion con correo.
const URLHacienda = "https://api.hacienda.go.cr/indicadores/tc/dolar"

// EdadMaximaTipoDeCambio es cuanto puede pasar sin que la fuente confirme el
// tipo de cambio antes de que el camino que cobra deje de usarlo. Cubre un fin
// de semana largo con feriado; mas que eso ya no es un tipo de cambio, es un
// numero viejo.
const EdadMaximaTipoDeCambio = 96 * time.Hour

// ErrTipoDeCambioViejo: el tipo de cambio vigente no se confirmo dentro de
// EdadMaximaTipoDeCambio.
var ErrTipoDeCambioViejo = errors.New("exchange rate is too old to charge with")

// Cotizacion es lo que publica la fuente para un dia.
type Cotizacion struct {
	Compra float64
	Venta  float64
	Fecha  time.Time
}

// FuenteTipoDeCambio trae la cotizacion vigente del dolar en colones.
type FuenteTipoDeCambio interface {
	Obtener(ctx context.Context) (*Cotizacion, error)
}

// FuenteHacienda lee URLHacienda.
type FuenteHacienda struct {
	URL    string
	Client *http.Client
}

// NewFuenteHacienda arma la fuente con un tiempo de espera propio: una fuente
// colgada no puede dejar colgado al actualizador.
func NewFuenteHacienda() *FuenteHacienda {
	return &FuenteHacienda{URL: URLHacienda, Client: &http.Client{Timeout: 15 * time.Second}}
}

func (f *FuenteHacienda) Obtener(ctx context.Context) (*Cotizacion, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, f.URL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	res, err := f.Client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("hacienda: %w", err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("hacienda: HTTP %d", res.StatusCode)
	}
	var cuerpo struct {
		Venta struct {
			Fecha string  `json:"fecha"`
			Valor float64 `json:"valor"`
		} `json:"venta"`
		Compra struct {
			Fecha string  `json:"fecha"`
			Valor float64 `json:"valor"`
		} `json:"compra"`
	}
	if err := json.NewDecoder(res.Body).Decode(&cuerpo); err != nil {
		return nil, fmt.Errorf("hacienda: respuesta ilegible: %w", err)
	}
	fecha, err := time.Parse("2006-01-02", cuerpo.Venta.Fecha)
	if err != nil {
		return nil, fmt.Errorf("hacienda: fecha ilegible %q", cuerpo.Venta.Fecha)
	}
	return &Cotizacion{Compra: cuerpo.Compra.Valor, Venta: cuerpo.Venta.Valor, Fecha: fecha}, nil
}

// validarCotizacion rechaza lo que no puede ser un tipo de cambio del colon.
//
// La fuente es externa y la cifra termina cobrando: un cero, un valor
// invertido o un error de separador decimal (45006 en vez de 450,06) no puede
// llegar a la base. Los limites son deliberadamente anchos — no pretenden
// adivinar el mercado, solo atajar basura.
func validarCotizacion(c *Cotizacion, ahora time.Time) error {
	if c == nil {
		return errors.New("cotizacion vacia")
	}
	if c.Compra < 100 || c.Venta < 100 || c.Compra > 5000 || c.Venta > 5000 {
		return fmt.Errorf("cotizacion fuera de rango: compra %.2f venta %.2f", c.Compra, c.Venta)
	}
	if c.Compra > c.Venta {
		return fmt.Errorf("compra %.2f mayor que venta %.2f", c.Compra, c.Venta)
	}
	if (c.Venta-c.Compra)/c.Venta > 0.10 {
		return fmt.Errorf("diferencia compra/venta anormal: %.2f / %.2f", c.Compra, c.Venta)
	}
	// Una fuente que sigue respondiendo con la fecha de hace una semana esta
	// muerta aunque conteste 200.
	if ahora.Sub(c.Fecha) > EdadMaximaTipoDeCambio {
		return fmt.Errorf("la fuente publica una cotizacion del %s", c.Fecha.Format("2006-01-02"))
	}
	return nil
}

// Actualizador mantiene el tipo de cambio USD/CRC al dia.
type Actualizador struct {
	repo   *Repository
	fuente FuenteTipoDeCambio
	cada   time.Duration
	logger *slog.Logger

	mu     sync.Mutex
	estado DiagnosticoTipoDeCambio
}

// DiagnosticoTipoDeCambio es lo que se publica en /health.
type DiagnosticoTipoDeCambio struct {
	Fuente             string     `json:"fuente"`
	UsdCrc             float64    `json:"usd_crc"`
	Compra             float64    `json:"compra"`
	FechaFuente        string     `json:"fecha_fuente,omitempty"`
	UltimaConfirmacion *time.Time `json:"ultima_confirmacion,omitempty"`
	UltimoError        string     `json:"ultimo_error,omitempty"`
}

func NewActualizador(repo *Repository, fuente FuenteTipoDeCambio, cada time.Duration, logger *slog.Logger) *Actualizador {
	if cada <= 0 {
		cada = time.Hour
	}
	if logger == nil {
		logger = slog.Default()
	}
	return &Actualizador{repo: repo, fuente: fuente, cada: cada, logger: logger,
		estado: DiagnosticoTipoDeCambio{Fuente: "hacienda"}}
}

// Run actualiza de inmediato y despues cada `cada`, hasta que ctx se cancele.
// Corre de inmediato porque al arrancar la semilla vieja ya esta vencida: sin
// esta primera pasada, cripto en colones quedaria fuera de servicio una hora.
//
// El error de cada pasada no se propaga: ActualizarUnaVez ya lo deja en el
// diagnostico de /health y en el log con nivel Error, y la siguiente pasada lo
// vuelve a intentar.
func (a *Actualizador) Run(ctx context.Context) {
	_ = a.ActualizarUnaVez(ctx)
	t := time.NewTicker(a.cada)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			_ = a.ActualizarUnaVez(ctx)
		}
	}
}

// ActualizarUnaVez trae la cotizacion y la guarda. Devuelve el error para las
// pruebas; en produccion el error queda en el diagnostico y en el log.
func (a *Actualizador) ActualizarUnaVez(ctx context.Context) error {
	c, err := a.fuente.Obtener(ctx)
	if err == nil {
		err = validarCotizacion(c, time.Now())
	}
	if err != nil {
		a.anotarError(err)
		// Error y no Warn: si esto se repite durante EdadMaximaTipoDeCambio,
		// cripto en colones deja de operar, y eso tiene que verse antes.
		a.logger.Error("tipo de cambio: no se pudo actualizar", "error", err)
		return err
	}

	// Una sola tasa de referencia, la de VENTA, para los dos sentidos. Asi el
	// precio que la pantalla muestra es exactamente el que se cobra, y una
	// vuelta USD -> CRC -> USD no crea plata. Cobrar la diferencia entre
	// compra y venta seria ponerle margen al precio: es una decision
	// comercial, no un arreglo tecnico.
	//
	// El balboa esta atado por ley 1:1 al dolar, asi que sus pares con el
	// colon son los mismos.
	pares := []struct {
		desde, hacia string
		tasa         float64
	}{
		{"USD", "CRC", c.Venta},
		{"CRC", "USD", 1 / c.Venta},
		{"PAB", "CRC", c.Venta},
		{"CRC", "PAB", 1 / c.Venta},
	}
	for _, p := range pares {
		if err := a.repo.RegistrarTipoDeCambio(ctx, p.desde, p.hacia, p.tasa, "hacienda"); err != nil {
			a.anotarError(err)
			a.logger.Error("tipo de cambio: no se pudo guardar", "par", p.desde+"/"+p.hacia, "error", err)
			return err
		}
	}

	ahora := time.Now()
	a.mu.Lock()
	a.estado = DiagnosticoTipoDeCambio{
		Fuente: "hacienda", UsdCrc: c.Venta, Compra: c.Compra,
		FechaFuente: c.Fecha.Format("2006-01-02"), UltimaConfirmacion: &ahora,
	}
	a.mu.Unlock()
	a.logger.Info("tipo de cambio actualizado", "usd_crc", c.Venta, "compra", c.Compra,
		"fecha", c.Fecha.Format("2006-01-02"))
	return nil
}

func (a *Actualizador) anotarError(err error) {
	a.mu.Lock()
	a.estado.UltimoError = err.Error()
	a.mu.Unlock()
}

// Diagnostico devuelve el ultimo estado conocido. Seguro para llamar desde
// cualquier goroutine.
func (a *Actualizador) Diagnostico() DiagnosticoTipoDeCambio {
	if a == nil {
		return DiagnosticoTipoDeCambio{}
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.estado
}

// cambioSignificativo dice si una tasa nueva merece una fila nueva en el
// historial. Por debajo de una parte en un millon es ruido de redondeo del
// NUMERIC(20,10) y de la division 1/venta.
func cambioSignificativo(vieja, nueva float64) bool {
	if vieja <= 0 {
		return true
	}
	return math.Abs(nueva-vieja)/vieja > 1e-6
}
