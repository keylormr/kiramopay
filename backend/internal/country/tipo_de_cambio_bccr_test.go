package country

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// El tipo de cambio sale del Banco Central (BCCR) por el SDDE, no solo de
// Hacienda, que apenas lo republica. Con BCCR_TOKEN cargado la fuente del dolar
// es el BCCR y Hacienda queda de respaldo; sin el token, Hacienda como hasta
// ahora. Y la fuente que se guarda y se publica en /health es la REAL de cada
// pasada, no una palabra escrita a mano.

const tokenDePrueba = "tok-secreto-de-prueba-123"

func f64(v float64) *float64 { return &v }

// diaBCCR es un dia de la serie: compra (317) y venta (318).
type diaBCCR struct {
	fecha         string
	compra, venta *float64
}

// cuerpoBCCR arma la respuesta del SDDE para el cuadro 1: los dos indicadores
// van en listas separadas y se juntan por fecha.
func cuerpoBCCR(estado bool, mensaje string, dias ...diaBCCR) string {
	type punto struct {
		Fecha string   `json:"fecha"`
		Valor *float64 `json:"valorDatoPorPeriodo"`
	}
	var compra, venta []punto
	for _, d := range dias {
		compra = append(compra, punto{d.fecha, d.compra})
		venta = append(venta, punto{d.fecha, d.venta})
	}
	cuerpo := map[string]any{
		"estado":  estado,
		"mensaje": mensaje,
		"datos": []any{map[string]any{
			"titulo": "Tipo cambio de compra y de venta del dolar de los Estados Unidos de America",
			"indicadores": []any{
				map[string]any{"codigoIndicador": "317", "nombreIndicador": "Tipo de cambio de compra", "series": compra},
				map[string]any{"codigoIndicador": "318", "nombreIndicador": "Tipo de cambio de venta", "series": venta},
			},
		}},
	}
	b, err := json.Marshal(cuerpo)
	if err != nil {
		panic(err)
	}
	return string(b)
}

// bccrQueResponde levanta un SDDE falso y devuelve la fuente apuntada a el.
func bccrQueResponde(t *testing.T, h http.HandlerFunc) *FuenteBCCR {
	t.Helper()
	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)
	return &FuenteBCCR{URL: srv.URL, Token: tokenDePrueba, Client: srv.Client()}
}

func respondeCon(cuerpo string) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(cuerpo))
	}
}

func TestFuenteBCCRPideLosUltimosDiezDiasConElTokenEnElEncabezado(t *testing.T) {
	var visto *http.Request
	f := bccrQueResponde(t, func(w http.ResponseWriter, r *http.Request) {
		visto = r.Clone(context.Background())
		_, _ = w.Write([]byte(cuerpoBCCR(true, "", diaBCCR{"2026-10-28", f64(444.1), f64(450.2)})))
	})
	// 02:00 UTC del 29 son las 20:00 del 28 en Costa Rica (UTC-6, sin horario de
	// verano): el dia que cuenta para el BCCR es el 28, no el 29.
	f.Ahora = func() time.Time { return time.Date(2026, 10, 29, 2, 0, 0, 0, time.UTC) }

	if _, err := f.Obtener(context.Background()); err != nil {
		t.Fatalf("Obtener: %v", err)
	}
	if visto == nil {
		t.Fatal("el servidor del BCCR no recibio ninguna peticion")
	}
	if visto.Method != http.MethodGet {
		t.Errorf("metodo = %s, se esperaba GET", visto.Method)
	}
	// El cuadro 1 trae la compra (317) y la venta (318) en una sola llamada.
	if visto.URL.Path != "/cuadro/1/series" {
		t.Errorf("ruta = %s, se esperaba /cuadro/1/series", visto.URL.Path)
	}
	if got := visto.Header.Get("Authorization"); got != "Bearer "+tokenDePrueba {
		t.Errorf("Authorization = %q, se esperaba el Bearer con el token", got)
	}
	if !strings.Contains(visto.Header.Get("Accept"), "application/json") {
		t.Errorf("Accept = %q, se esperaba JSON", visto.Header.Get("Accept"))
	}
	q := visto.URL.Query()
	// Fechas con barras (AAAA/MM/DD) y diez dias hacia atras: asi una corrida
	// que se salto un dia se completa sola.
	if q.Get("fechaInicio") != "2026/10/18" || q.Get("fechaFin") != "2026/10/28" {
		t.Errorf("rango = %s a %s, se esperaba 2026/10/18 a 2026/10/28", q.Get("fechaInicio"), q.Get("fechaFin"))
	}
	if q.Get("idioma") != "es" {
		t.Errorf("idioma = %q, se esperaba es", q.Get("idioma"))
	}
}

func TestFuenteBCCRLeeLaCompraYLaVentaDelDiaMasReciente(t *testing.T) {
	// El dia mas reciente va primero a proposito: manda la fecha, no la posicion.
	f := bccrQueResponde(t, respondeCon(cuerpoBCCR(true, "",
		diaBCCR{"2026-10-28", f64(444.10), f64(450.20)},
		diaBCCR{"2026-10-26", f64(443.00), f64(449.00)},
		diaBCCR{"2026-10-27", f64(443.50), f64(449.60)},
	)))

	c, err := f.Obtener(context.Background())
	if err != nil {
		t.Fatalf("Obtener: %v", err)
	}
	if c.Compra != 444.10 || c.Venta != 450.20 {
		t.Fatalf("cotizacion = compra %v / venta %v, se esperaba 444.10 / 450.20", c.Compra, c.Venta)
	}
	if c.Fecha.Format("2006-01-02") != "2026-10-28" {
		t.Fatalf("fecha = %s, se esperaba 2026-10-28", c.Fecha.Format("2006-01-02"))
	}
	if c.Fuente != "bccr" {
		t.Fatalf("fuente = %q, se esperaba bccr", c.Fuente)
	}
}

// Media cotizacion no es una cotizacion: un dia al que le falta una de las dos
// puntas se descarta y se usa el anterior completo.
func TestFuenteBCCRDescartaElDiaSinUnaDeLasDosPuntas(t *testing.T) {
	completo := diaBCCR{"2026-10-27", f64(443.50), f64(449.60)}
	casos := map[string]diaBCCR{
		"sin compra":     {"2026-10-28", nil, f64(450.20)},
		"sin venta":      {"2026-10-28", f64(444.10), nil},
		"compra en cero": {"2026-10-28", f64(0), f64(450.20)},
		"venta en cero":  {"2026-10-28", f64(444.10), f64(0)},
	}
	for nombre, incompleto := range casos {
		t.Run(nombre, func(t *testing.T) {
			f := bccrQueResponde(t, respondeCon(cuerpoBCCR(true, "", incompleto, completo)))
			c, err := f.Obtener(context.Background())
			if err != nil {
				t.Fatalf("Obtener: %v", err)
			}
			if c.Fecha.Format("2006-01-02") != "2026-10-27" || c.Compra != 443.50 || c.Venta != 449.60 {
				t.Fatalf("cotizacion = %+v, se esperaba la completa del 2026-10-27", c)
			}
		})
	}
}

func TestFuenteBCCRSinNingunDiaCompletoNoInventaUnaCotizacion(t *testing.T) {
	casos := map[string]string{
		"todos incompletos": cuerpoBCCR(true, "",
			diaBCCR{"2026-10-28", nil, f64(450.20)},
			diaBCCR{"2026-10-27", f64(443.50), nil}),
		"serie vacia": cuerpoBCCR(true, ""),
	}
	for nombre, cuerpo := range casos {
		t.Run(nombre, func(t *testing.T) {
			f := bccrQueResponde(t, respondeCon(cuerpo))
			if c, err := f.Obtener(context.Background()); err == nil {
				t.Fatalf("se esperaba error y devolvio %+v", c)
			}
		})
	}
}

// estado:false es un rechazo aunque el HTTP sea 200, y sus datos no se leen.
func TestFuenteBCCRUnEstadoFalsoEsUnRechazoAunqueSeaHTTP200(t *testing.T) {
	f := bccrQueResponde(t, respondeCon(cuerpoBCCR(false, "token vencido",
		diaBCCR{"2026-10-28", f64(444.10), f64(450.20)})))

	c, err := f.Obtener(context.Background())
	if err == nil {
		t.Fatalf("estado:false se tomo por una cotizacion: %+v", c)
	}
	if !strings.Contains(err.Error(), "token vencido") {
		t.Errorf("el error no dice lo que respondio el BCCR: %v", err)
	}
	if esFallaPasajera(err) {
		t.Errorf("un rechazo del BCCR no se arregla esperando: %v", err)
	}
}

func TestFuenteBCCRRespuestaIlegibleNoSeTomaPorUnaCotizacion(t *testing.T) {
	f := bccrQueResponde(t, respondeCon("<html>mantenimiento</html>"))
	if c, err := f.Obtener(context.Background()); err == nil || esFallaPasajera(err) {
		t.Fatalf("se esperaba un error permanente y fue (%+v, %v)", c, err)
	}
}

// 401 es el token vencido o mal copiado y 404 es la ruta: los dos se arreglan en
// la configuracion, no reintentando. Y el token no se escribe en ningun error:
// el mensaje termina en /health y en los registros.
func TestFuenteBCCR401y404NoSonFallasPasajeras(t *testing.T) {
	for _, codigo := range []int{http.StatusUnauthorized, http.StatusNotFound} {
		t.Run(fmt.Sprint(codigo), func(t *testing.T) {
			f := bccrQueResponde(t, func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(codigo)
				// Un servidor que devuelve el encabezado que recibio.
				_, _ = w.Write([]byte("rechazado: " + r.Header.Get("Authorization")))
			})
			_, err := f.Obtener(context.Background())
			if err == nil {
				t.Fatal("se esperaba error")
			}
			if esFallaPasajera(err) {
				t.Errorf("HTTP %d no es una falla que se arregle sola: %v", codigo, err)
			}
			if !strings.Contains(err.Error(), fmt.Sprint(codigo)) {
				t.Errorf("el error no lleva el codigo %d: %v", codigo, err)
			}
			if strings.Contains(err.Error(), tokenDePrueba) {
				t.Errorf("el token quedo escrito en el error: %v", err)
			}
		})
	}
}

func TestFuenteBCCR5xxY429SiSonFallasPasajeras(t *testing.T) {
	for _, codigo := range []int{http.StatusInternalServerError, http.StatusServiceUnavailable, http.StatusTooManyRequests} {
		t.Run(fmt.Sprint(codigo), func(t *testing.T) {
			f := bccrQueResponde(t, func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(codigo) })
			_, err := f.Obtener(context.Background())
			if err == nil || !esFallaPasajera(err) {
				t.Fatalf("HTTP %d se arregla solo y el error fue %v", codigo, err)
			}
		})
	}
}

func TestFuenteBCCRSinRedEsFallaPasajeraYNoFiltraElToken(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	f := &FuenteBCCR{URL: srv.URL, Token: tokenDePrueba, Client: srv.Client()}
	srv.Close() // la conexion se rechaza

	_, err := f.Obtener(context.Background())
	if err == nil || !esFallaPasajera(err) {
		t.Fatalf("una red caida se arregla sola y el error fue %v", err)
	}
	if strings.Contains(err.Error(), tokenDePrueba) {
		t.Errorf("el token quedo escrito en el error: %v", err)
	}
}

func TestFuenteBCCRSinTokenNoSaleALaRed(t *testing.T) {
	var llamadas atomic.Int32
	f := bccrQueResponde(t, func(http.ResponseWriter, *http.Request) { llamadas.Add(1) })
	f.Token = ""

	if c, err := f.Obtener(context.Background()); err == nil {
		t.Fatalf("sin token se esperaba error y devolvio %+v", c)
	}
	if llamadas.Load() != 0 {
		t.Fatalf("sin token se hicieron %d llamadas al BCCR", llamadas.Load())
	}
}

// ── La fuente del dolar: BCCR con Hacienda de respaldo ───────────────────────

// cotizacionReciente es una cotizacion buena del dia, con la fuente que diga.
func cotizacionReciente(fuente string) *Cotizacion {
	n := time.Now().UTC()
	return &Cotizacion{
		Compra: 444.22, Venta: 450.06, Fuente: fuente,
		Fecha: time.Date(n.Year(), n.Month(), n.Day(), 0, 0, 0, 0, time.UTC),
	}
}

// fuenteQueNoDebeLlamarse falla la prueba si alguien le pide la cotizacion.
type fuenteQueNoDebeLlamarse struct{ t *testing.T }

func (f fuenteQueNoDebeLlamarse) Obtener(context.Context) (*Cotizacion, error) {
	f.t.Helper()
	f.t.Error("se llamo a una fuente que no tenia que consultarse")
	return nil, errString("no debia llamarse")
}

func TestConTokenElDolarSaleDelBCCR(t *testing.T) {
	f := &FuenteConRespaldo{
		Principal: fuenteFija{c: cotizacionReciente("bccr")},
		Respaldo:  fuenteQueNoDebeLlamarse{t},
	}
	c, err := f.Obtener(context.Background())
	if err != nil {
		t.Fatalf("Obtener: %v", err)
	}
	if c.Fuente != "bccr" || c.FallaPrincipal != nil {
		t.Fatalf("fuente = %q, falla de la principal = %v; se esperaba bccr y ninguna falla", c.Fuente, c.FallaPrincipal)
	}
}

func TestSiElBCCRFallaElDolarSaleDeHacienda(t *testing.T) {
	f := &FuenteConRespaldo{
		Principal: fuenteFija{err: errString("bccr: HTTP 401")},
		Respaldo:  fuenteFija{c: cotizacionReciente("hacienda")},
	}
	c, err := f.Obtener(context.Background())
	if err != nil {
		t.Fatalf("con Hacienda de respaldo la pasada no tiene que fallar: %v", err)
	}
	if c.Fuente != "hacienda" {
		t.Fatalf("fuente = %q, se esperaba hacienda", c.Fuente)
	}
	// La falla del BCCR no se pierde: es lo que /health y el registro muestran.
	if c.FallaPrincipal == nil || !strings.Contains(c.FallaPrincipal.Error(), "HTTP 401") {
		t.Fatalf("falla de la principal = %v, se esperaba el 401 del BCCR", c.FallaPrincipal)
	}
}

// Una cifra del BCCR que no puede ser un tipo de cambio del colon no pasa: se
// cae al respaldo en vez de cobrar con ella.
func TestUnaCotizacionInvalidaDelBCCRTambienCaeAHacienda(t *testing.T) {
	absurda := cotizacionReciente("bccr")
	absurda.Compra, absurda.Venta = 1, 2
	f := &FuenteConRespaldo{
		Principal: fuenteFija{c: absurda},
		Respaldo:  fuenteFija{c: cotizacionReciente("hacienda")},
	}
	c, err := f.Obtener(context.Background())
	if err != nil {
		t.Fatalf("Obtener: %v", err)
	}
	if c.Fuente != "hacienda" || c.FallaPrincipal == nil {
		t.Fatalf("fuente = %q, falla = %v; se esperaba hacienda con la falla del BCCR", c.Fuente, c.FallaPrincipal)
	}
}

func TestSiFallanLasDosElErrorDiceLasDosYSoloEsPasajeroSiLoSonAmbas(t *testing.T) {
	permanente := errString("bccr: HTTP 401")
	pasajera := func(msg string) error { return fallaPasajera{errString(msg)} }

	casos := []struct {
		nombre              string
		principal, respaldo error
		pasajero            bool
	}{
		{"ambas pasajeras", pasajera("bccr: HTTP 503"), pasajera("hacienda: HTTP 503"), true},
		{"el BCCR rechaza el token y Hacienda cae", permanente, pasajera("hacienda: HTTP 503"), false},
		{"el BCCR cae y Hacienda responde basura", pasajera("bccr: HTTP 503"), errString("hacienda: respuesta ilegible"), false},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			f := &FuenteConRespaldo{
				Principal: fuenteFija{err: c.principal},
				Respaldo:  fuenteFija{err: c.respaldo},
			}
			cot, err := f.Obtener(context.Background())
			if err == nil {
				t.Fatalf("con las dos fuentes caidas se esperaba error y devolvio %+v", cot)
			}
			for _, parte := range []string{c.principal.Error(), c.respaldo.Error()} {
				if !strings.Contains(err.Error(), parte) {
					t.Errorf("el error %q no menciona %q", err, parte)
				}
			}
			if esFallaPasajera(err) != c.pasajero {
				t.Errorf("esFallaPasajera = %v, se esperaba %v", esFallaPasajera(err), c.pasajero)
			}
		})
	}
}

func TestSinTokenElDolarSaleDeHaciendaYSeDiceQueFalta(t *testing.T) {
	for _, token := range []string{"", "   "} {
		f := NewFuenteDelDolar(token)
		if f.Principal != nil {
			t.Errorf("token %q: sin token no hay fuente principal, y hay %T", token, f.Principal)
		}
		if got := f.Faltantes(); len(got) != 1 || got[0] != "BCCR_TOKEN" {
			t.Errorf("token %q: faltantes = %v, se esperaba [BCCR_TOKEN]", token, got)
		}
		if f.Respaldo == nil {
			t.Errorf("token %q: Hacienda tiene que seguir sirviendo", token)
		}
	}

	f := NewFuenteDelDolar(tokenDePrueba)
	if _, ok := f.Principal.(*FuenteBCCR); !ok {
		t.Errorf("con token la fuente principal es el BCCR, y es %T", f.Principal)
	}
	if got := f.Faltantes(); len(got) != 0 {
		t.Errorf("con token no falta nada y faltan %v", got)
	}
	// El euro sigue saliendo de Hacienda.
	if _, ok := f.Respaldo.(*FuenteHacienda); !ok {
		t.Errorf("el respaldo es Hacienda y es %T", f.Respaldo)
	}
	if f.Euro == nil {
		t.Error("el euro sigue saliendo de Hacienda")
	}
}

func TestElDiagnosticoDiceQueFaltaElTokenSinNombrarSuValor(t *testing.T) {
	sin := NewActualizador(nil, NewFuenteDelDolar(""), time.Hour, nil).Diagnostico()
	if len(sin.Falta) != 1 || sin.Falta[0] != "BCCR_TOKEN" {
		t.Fatalf("falta = %v, se esperaba [BCCR_TOKEN]", sin.Falta)
	}
	b, err := json.Marshal(sin)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(b, []byte(`"falta":["BCCR_TOKEN"]`)) {
		t.Errorf("/health no dice que falta BCCR_TOKEN: %s", b)
	}

	con := NewActualizador(nil, NewFuenteDelDolar(tokenDePrueba), time.Hour, nil).Diagnostico()
	if len(con.Falta) != 0 {
		t.Fatalf("con token no falta nada y falta %v", con.Falta)
	}
	b, _ = json.Marshal(con)
	if bytes.Contains(b, []byte(tokenDePrueba)) || bytes.Contains(b, []byte(`"falta"`)) {
		t.Errorf("con token /health no menciona nada que falte ni el valor del token: %s", b)
	}
}

// ── El nivel con que se registra cada falla ──────────────────────────────────

func bccrYHaciendaCaidos(t *testing.T, bccr, hacienda int) *FuenteConRespaldo {
	t.Helper()
	b := bccrQueResponde(t, func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(bccr) })
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(hacienda) }))
	t.Cleanup(srv.Close)
	return &FuenteConRespaldo{
		Principal: b,
		Respaldo:  &FuenteHacienda{URL: srv.URL, Client: srv.Client()},
	}
}

func actualizadorConRegistro(fuente FuenteTipoDeCambio) (*Actualizador, *bytes.Buffer) {
	var buf bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&buf, &slog.HandlerOptions{Level: slog.LevelDebug}))
	return NewActualizador(nil, fuente, time.Hour, logger), &buf
}

// Un token que el BCCR rechaza no se arregla esperando: tiene que verse como
// ERROR aunque Hacienda tambien este caida con un 503 pasajero.
func TestUnTokenRechazadoEsErrorAunqueHaciendaTambienCaiga(t *testing.T) {
	a, buf := actualizadorConRegistro(bccrYHaciendaCaidos(t, http.StatusUnauthorized, http.StatusServiceUnavailable))

	if err := a.ActualizarUnaVez(context.Background()); err == nil {
		t.Fatal("con las dos fuentes caidas la pasada tiene que fallar")
	}
	salida := buf.String()
	if !strings.Contains(salida, "level=ERROR") || !strings.Contains(salida, "401") {
		t.Errorf("se esperaba un ERROR con el 401 del BCCR, el registro dice: %s", salida)
	}
	if strings.Contains(salida, tokenDePrueba) {
		t.Errorf("el token quedo escrito en el registro: %s", salida)
	}
	if d := a.Diagnostico(); !strings.Contains(d.UltimoError, "401") {
		t.Errorf("ultimo_error = %q, se esperaba el 401", d.UltimoError)
	}
}

// Dos 503 seguidos de las dos fuentes son lo de siempre: se arregla solo.
func TestLosDos503PasajerosSonWarnNoError(t *testing.T) {
	a, buf := actualizadorConRegistro(bccrYHaciendaCaidos(t, http.StatusServiceUnavailable, http.StatusServiceUnavailable))

	if err := a.ActualizarUnaVez(context.Background()); err == nil {
		t.Fatal("con las dos fuentes caidas la pasada tiene que fallar")
	}
	salida := buf.String()
	if strings.Contains(salida, "level=ERROR") {
		t.Errorf("dos 503 aislados no son un ERROR: %s", salida)
	}
	if !strings.Contains(salida, "level=WARN") {
		t.Errorf("se esperaba un WARN, el registro dice: %s", salida)
	}
}
