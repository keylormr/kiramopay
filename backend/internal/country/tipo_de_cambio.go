package country

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"net/http"
	"strings"
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
// tipo de cambio de referencia del BCCR. No pide registro ni token. Es el
// respaldo del dolar cuando el BCCR falla, la fuente cuando no hay BCCR_TOKEN y
// la fuente del euro (ver tipo_de_cambio_bccr.go).
const URLHacienda = "https://api.hacienda.go.cr/indicadores/tc/dolar"

// URLHaciendaEuro es el mismo servicio para el euro. Responde la fecha del BCCR
// y cuantos dolares y cuantos colones vale un euro; el BCCR lo publica solo en
// dias habiles, asi que un lunes todavia trae la fecha del viernes.
const URLHaciendaEuro = "https://api.hacienda.go.cr/indicadores/tc/euro"

// EdadMaximaEuro es cuan vieja puede venir la cotizacion del euro antes de
// tomarla por una fuente muerta. Es mas larga que la del dolar porque el euro
// no se publica los fines de semana ni los feriados.
const EdadMaximaEuro = 7 * 24 * time.Hour

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
	// Fuente dice de donde salio esta cotizacion (NombreFuenteBCCR,
	// NombreFuenteHacienda). Es lo que se guarda en la fila y se publica en
	// /health: la fuente REAL de la pasada, no una palabra escrita a mano. Una
	// cotizacion que no la declare se registra como de Hacienda, la unica fuente
	// que existia antes de esta.
	Fuente string
	// FallaPrincipal, si no es nil, dice por que esta cotizacion salio del
	// respaldo y no de la fuente principal (el BCCR). La cotizacion es buena; el
	// aviso es para que la falla de la principal no se esconda.
	FallaPrincipal error
}

// fuenteDe es la fuente que se anota para una cotizacion.
func (c *Cotizacion) fuenteDe() string {
	if c.Fuente == "" {
		return NombreFuenteHacienda
	}
	return c.Fuente
}

// pasadasFallidasParaAlertar son las pasadas seguidas sin que la fuente
// confirme a partir de las cuales una falla pasajera deja de registrarse como
// WARN y pasa a ERROR. Con el intervalo por defecto (una hora) son seis horas:
// de sobra para que un 503 de Hacienda se arregle solo, y muy lejos de las 96
// horas de EdadMaximaTipoDeCambio en que cripto en colones deja de operar, asi
// que la alerta llega con tiempo para actuar.
const pasadasFallidasParaAlertar = 6

// fallaPasajera marca el error de la fuente que se espera que se arregle solo:
// un 5xx, un 429 o una red que no responde. Conserva el mensaje del error
// original, que es el que se publica en /health. Una respuesta que llego pero
// no sirve (un 404, basura, una cifra fuera de rango) NO lo es: eso no se
// arregla esperando.
type fallaPasajera struct{ err error }

func (f fallaPasajera) Error() string { return f.err.Error() }
func (f fallaPasajera) Unwrap() error { return f.err }

func esFallaPasajera(err error) bool {
	var f fallaPasajera
	return errors.As(err, &f)
}

// estadoPasajero dice si un codigo HTTP de la fuente es de los que se arreglan
// solos.
func estadoPasajero(codigo int) bool {
	return codigo >= http.StatusInternalServerError || codigo == http.StatusTooManyRequests
}

// nivelDeFalla decide con que nivel se registra una pasada fallida, siendo
// seguidas el numero de pasadas seguidas sin confirmar contando la actual: WARN
// si la falla es pasajera y todavia es corta, ERROR en cualquier otro caso.
func nivelDeFalla(err error, seguidas int) slog.Level {
	if esFallaPasajera(err) && seguidas < pasadasFallidasParaAlertar {
		return slog.LevelWarn
	}
	return slog.LevelError
}

// FuenteTipoDeCambio trae la cotizacion vigente del dolar en colones.
type FuenteTipoDeCambio interface {
	Obtener(ctx context.Context) (*Cotizacion, error)
}

// FuenteEuro la cumple una fuente que tambien publica la cotizacion del euro:
// cuantos dolares vale un euro, con la fecha del BCCR. Va aparte del dolar a
// proposito: si el euro falla, el dolar con el que se cobra se actualiza igual.
type FuenteEuro interface {
	ObtenerEuro(ctx context.Context) (dolaresPorEuro float64, fecha time.Time, err error)
}

// FuenteHacienda lee URLHacienda y URLHaciendaEuro.
type FuenteHacienda struct {
	URL     string
	URLEuro string
	Client  *http.Client
}

// NewFuenteHacienda arma la fuente con un tiempo de espera propio: una fuente
// colgada no puede dejar colgado al actualizador.
func NewFuenteHacienda() *FuenteHacienda {
	return &FuenteHacienda{URL: URLHacienda, URLEuro: URLHaciendaEuro, Client: &http.Client{Timeout: 15 * time.Second}}
}

func (f *FuenteHacienda) ObtenerEuro(ctx context.Context) (float64, time.Time, error) {
	if f.URLEuro == "" {
		return 0, time.Time{}, errors.New("hacienda: sin direccion para el euro")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, f.URLEuro, nil)
	if err != nil {
		return 0, time.Time{}, err
	}
	req.Header.Set("Accept", "application/json")
	res, err := f.Client.Do(req)
	if err != nil {
		return 0, time.Time{}, fallaPasajera{fmt.Errorf("hacienda euro: %w", err)}
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		err := fmt.Errorf("hacienda euro: HTTP %d", res.StatusCode)
		if estadoPasajero(res.StatusCode) {
			err = fallaPasajera{err}
		}
		return 0, time.Time{}, err
	}
	var cuerpo struct {
		Fecha   string  `json:"fecha"`
		Dolares float64 `json:"dolares"`
	}
	if err := json.NewDecoder(res.Body).Decode(&cuerpo); err != nil {
		return 0, time.Time{}, fmt.Errorf("hacienda euro: respuesta ilegible: %w", err)
	}
	fecha, err := time.Parse("2006-01-02", cuerpo.Fecha)
	if err != nil {
		return 0, time.Time{}, fmt.Errorf("hacienda euro: fecha ilegible %q", cuerpo.Fecha)
	}
	return cuerpo.Dolares, fecha, nil
}

// validarEuro rechaza lo que no puede ser una cotizacion del euro en dolares.
// Igual que con el colon, los limites son anchos: solo atajan basura.
func validarEuro(dolaresPorEuro float64, fecha, ahora time.Time) error {
	if dolaresPorEuro < 0.5 || dolaresPorEuro > 3 {
		return fmt.Errorf("euro fuera de rango: %v dolares por euro", dolaresPorEuro)
	}
	if ahora.Sub(fecha) > EdadMaximaEuro {
		return fmt.Errorf("la fuente publica un euro del %s", fecha.Format("2006-01-02"))
	}
	return nil
}

func (f *FuenteHacienda) Obtener(ctx context.Context) (*Cotizacion, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, f.URL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	res, err := f.Client.Do(req)
	if err != nil {
		return nil, fallaPasajera{fmt.Errorf("hacienda: %w", err)}
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		err := fmt.Errorf("hacienda: HTTP %d", res.StatusCode)
		if estadoPasajero(res.StatusCode) {
			err = fallaPasajera{err}
		}
		return nil, err
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
	return &Cotizacion{Compra: cuerpo.Compra.Valor, Venta: cuerpo.Venta.Valor, Fecha: fecha, Fuente: NombreFuenteHacienda}, nil
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
	// falta son las variables de entorno sin cargar que la fuente dice echar de
	// menos (BCCR_TOKEN). Se republican en cada diagnostico.
	falta []string
	// Pasadas seguidas sin que la fuente confirme el dolar y el euro. Deciden
	// el nivel del registro de una falla pasajera (nivelDeFalla); una pasada
	// buena las pone en cero.
	fallasSeguidas, fallasEuroSeguidas int
	// Pasadas seguidas en que el BCCR no sirvio y el dolar salio del respaldo.
	// Mismo uso que fallasSeguidas, para la fuente principal.
	fallasPrincipalSeguidas int
}

// DiagnosticoTipoDeCambio es lo que se publica en /health.
type DiagnosticoTipoDeCambio struct {
	// Fuente es de donde salio la ultima tasa confirmada ("bccr" o "hacienda");
	// queda vacia mientras ninguna pasada haya confirmado una.
	Fuente             string     `json:"fuente"`
	UsdCrc             float64    `json:"usd_crc"`
	Compra             float64    `json:"compra"`
	FechaFuente        string     `json:"fecha_fuente,omitempty"`
	UltimaConfirmacion *time.Time `json:"ultima_confirmacion,omitempty"`
	UltimoError        string     `json:"ultimo_error,omitempty"`
	// Falta son los NOMBRES de las variables de entorno que hacen falta para que
	// el dolar salga del BCCR (BCCR_TOKEN). Jamas un valor.
	Falta []string `json:"falta,omitempty"`
}

func NewActualizador(repo *Repository, fuente FuenteTipoDeCambio, cada time.Duration, logger *slog.Logger) *Actualizador {
	if cada <= 0 {
		cada = time.Hour
	}
	if logger == nil {
		logger = slog.Default()
	}
	var falta []string
	if f, ok := fuente.(interface{ Faltantes() []string }); ok {
		falta = f.Faltantes()
	}
	return &Actualizador{repo: repo, fuente: fuente, cada: cada, logger: logger, falta: falta,
		estado: DiagnosticoTipoDeCambio{Falta: falta}}
}

// euroDe devuelve la fuente del euro de una fuente de tipo de cambio, o nil si no
// tiene. La del dolar con respaldo lleva la suya aparte: el euro sale de Hacienda
// aunque el dolar salga del BCCR.
func euroDe(f FuenteTipoDeCambio) FuenteEuro {
	if c, ok := f.(*FuenteConRespaldo); ok {
		return c.Euro
	}
	fe, _ := f.(FuenteEuro)
	return fe
}

// Run actualiza de inmediato y despues cada `cada`, hasta que ctx se cancele.
// Corre de inmediato porque al arrancar la semilla vieja ya esta vencida: sin
// esta primera pasada, cripto en colones quedaria fuera de servicio una hora.
//
// El error de cada pasada no se propaga: ActualizarUnaVez ya lo deja en el
// diagnostico de /health y en el log (WARN si es una falla pasajera de la
// fuente y todavia corta, ERROR si no), y la siguiente pasada lo vuelve a
// intentar.
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
		a.mu.Lock()
		a.fallasSeguidas++
		seguidas := a.fallasSeguidas
		a.mu.Unlock()
		// Un 503 que se arregla solo es WARN; si se repite hasta
		// pasadasFallidasParaAlertar pasadas, o la respuesta llego pero no
		// sirve, es ERROR: pasadas EdadMaximaTipoDeCambio sin confirmar,
		// cripto en colones deja de operar, y eso tiene que verse antes.
		a.logger.Log(ctx, nivelDeFalla(err, seguidas), "tipo de cambio: no se pudo actualizar",
			"error", err, "pasadas_seguidas", seguidas)
		return err
	}
	a.mu.Lock()
	a.fallasSeguidas = 0
	a.mu.Unlock()
	fuente := c.fuenteDe()
	avisoDelRespaldo := a.anotarFallaPrincipal(ctx, c, fuente)

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
		if err := a.repo.RegistrarTipoDeCambio(ctx, p.desde, p.hacia, p.tasa, fuente); err != nil {
			a.anotarError(err)
			a.logger.Error("tipo de cambio: no se pudo guardar", "par", p.desde+"/"+p.hacia, "error", err)
			return err
		}
	}

	// La venta de cada dia, con la fecha que le pone el BCCR. exchange_rates
	// guarda una fila solo cuando la tasa cambia, y con la hora en que se trajo:
	// no dice cual era la venta de un dia dado, que es lo que la UIF necesita
	// (el total del mes se convierte con la del ultimo dia del mes).
	// Si no se puede guardar, el dolar ya quedo y se sigue: el cobro no depende
	// de esta tabla, y para un dia sin venta guardada la UIF usa el historial de
	// exchange_rates. El diagnostico lo dice.
	var avisos []string
	if avisoDelRespaldo != "" {
		avisos = append(avisos, avisoDelRespaldo)
	}
	if err := a.repo.RegistrarCotizacionDelDia(ctx, "CRC", c.Fecha, c.Venta, fuente); err != nil {
		avisos = append(avisos, "venta del dia: "+err.Error())
		a.logger.Error("tipo de cambio: no se pudo guardar la venta del dia", "error", err)
	}
	if fe := euroDe(a.fuente); fe != nil {
		a.actualizarEuro(ctx, fe)
	}

	ahora := time.Now()
	a.mu.Lock()
	a.estado = DiagnosticoTipoDeCambio{
		Fuente: fuente, UsdCrc: c.Venta, Compra: c.Compra,
		FechaFuente: c.Fecha.Format("2006-01-02"), UltimaConfirmacion: &ahora,
		UltimoError: strings.Join(avisos, "; "), Falta: a.falta,
	}
	a.mu.Unlock()
	a.logger.Info("tipo de cambio actualizado", "usd_crc", c.Venta, "compra", c.Compra,
		"fecha", c.Fecha.Format("2006-01-02"), "fuente", fuente)
	return nil
}

// anotarFallaPrincipal registra que el BCCR no sirvio cuando el dolar de esta
// pasada salio del respaldo, y devuelve el texto para el diagnostico ("" si la
// principal sirvio o no hay principal). Una falla pasajera es WARN mientras sea
// corta; un token rechazado o una ruta equivocada no se arreglan esperando y van
// a ERROR de entrada. La principal que vuelve a servir pone la cuenta en cero.
func (a *Actualizador) anotarFallaPrincipal(ctx context.Context, c *Cotizacion, fuente string) string {
	a.mu.Lock()
	switch {
	case c.FallaPrincipal != nil:
		a.fallasPrincipalSeguidas++
	case fuente == NombreFuenteBCCR:
		a.fallasPrincipalSeguidas = 0
	}
	seguidas := a.fallasPrincipalSeguidas
	a.mu.Unlock()

	if c.FallaPrincipal == nil {
		return ""
	}
	a.logger.Log(ctx, nivelDeFalla(c.FallaPrincipal, seguidas),
		"tipo de cambio: el BCCR no sirvio, el dolar salio del respaldo",
		"error", c.FallaPrincipal, "respaldo", fuente, "pasadas_seguidas", seguidas)
	return fmt.Sprintf("%v; se uso %s", c.FallaPrincipal, fuente)
}

// actualizarEuro guarda la cotizacion del euro del dia, en euros por dolar como
// todo lo demas. Hoy ninguna billetera opera en euros: la cotizacion esta para
// que la UIF pueda dolarizar un monto en euros con la del BCCR. Su falla solo
// queda en el log, sin tocar el dolar.
func (a *Actualizador) actualizarEuro(ctx context.Context, fe FuenteEuro) {
	dolares, fecha, err := fe.ObtenerEuro(ctx)
	if err == nil {
		err = validarEuro(dolares, fecha, time.Now())
	}
	if err == nil {
		err = a.repo.RegistrarCotizacionDelDia(ctx, "EUR", fecha, 1/dolares, NombreFuenteHacienda)
	}
	a.mu.Lock()
	if err == nil {
		a.fallasEuroSeguidas = 0
	} else {
		a.fallasEuroSeguidas++
	}
	seguidas := a.fallasEuroSeguidas
	a.mu.Unlock()
	if err != nil {
		a.logger.Log(ctx, nivelDeFalla(err, seguidas), "tipo de cambio: no se pudo actualizar el euro",
			"error", err, "pasadas_seguidas", seguidas)
	}
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
