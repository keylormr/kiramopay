package country

import (
	"bytes"
	"context"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// Hacienda devuelve 503 de vez en cuando y a la hora siguiente contesta. Cada
// pasada fallida quedaba en ERROR, y un 503 que se arregla solo es ruido que
// tapa los errores de verdad en el panel de logs.
//
// La regla: una falla pasajera de la fuente (5xx, 429, red) es WARN mientras sea
// corta; si se repite pasada tras pasada vuelve a ERROR, porque pasadas las 96
// horas sin confirmar (EdadMaximaTipoDeCambio) cripto en colones deja de operar
// y eso tiene que verse antes. Una respuesta que llego pero no sirve (basura,
// fuera de rango, un 404) sigue siendo ERROR de entrada.

// registroDelActualizador arma un actualizador sin base —las pasadas que fallan
// no llegan a tocarla— cuyo logger deja todo en el buffer que devuelve.
func registroDelActualizador(fuente FuenteTipoDeCambio) (*Actualizador, *bytes.Buffer) {
	var buf bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&buf, &slog.HandlerOptions{Level: slog.LevelDebug}))
	return NewActualizador(nil, fuente, time.Hour, logger), &buf
}

func hacienda503(t *testing.T) *FuenteHacienda {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	t.Cleanup(srv.Close)
	return &FuenteHacienda{URL: srv.URL, URLEuro: srv.URL, Client: srv.Client()}
}

func TestUn503PasajeroDeHaciendaEsWarnNoError(t *testing.T) {
	a, buf := registroDelActualizador(hacienda503(t))

	if err := a.ActualizarUnaVez(context.Background()); err == nil {
		t.Fatal("una fuente caida tiene que devolver error")
	}
	salida := buf.String()
	if strings.Contains(salida, "level=ERROR") {
		t.Errorf("un 503 aislado no es un ERROR: %s", salida)
	}
	if !strings.Contains(salida, "level=WARN") || !strings.Contains(salida, "HTTP 503") {
		t.Errorf("se esperaba un WARN con el 503, el registro dice: %s", salida)
	}
}

func TestUnaFuenteSinRedEsWarnNoError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	f := &FuenteHacienda{URL: srv.URL, Client: srv.Client()}
	srv.Close() // la conexion se rechaza: la red, no la respuesta, es lo que falla
	a, buf := registroDelActualizador(f)

	if err := a.ActualizarUnaVez(context.Background()); err == nil {
		t.Fatal("una fuente inalcanzable tiene que devolver error")
	}
	if salida := buf.String(); strings.Contains(salida, "level=ERROR") {
		t.Errorf("una falla de red aislada no es un ERROR: %s", salida)
	}
}

func TestElEuroCaidoEsWarnNoError(t *testing.T) {
	fuente := hacienda503(t)
	a, buf := registroDelActualizador(fuente)

	a.actualizarEuro(context.Background(), fuente)

	salida := buf.String()
	if strings.Contains(salida, "level=ERROR") {
		t.Errorf("un 503 del euro no es un ERROR: %s", salida)
	}
	if !strings.Contains(salida, "level=WARN") {
		t.Errorf("se esperaba un WARN, el registro dice: %s", salida)
	}
}

// Solo lo que se arregla esperando es pasajero. Una respuesta que llego pero no
// sirve es un error de verdad desde la primera vez: la URL cambio, Hacienda nos
// bloqueo, o el formato cambio y el actualizador ya no entiende lo que lee.
func TestSoloLasFallasQueSeArreglanSolasSonPasajeras(t *testing.T) {
	casos := []struct {
		nombre   string
		handler  http.HandlerFunc
		pasajera bool
	}{
		{"500", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(500) }, true},
		{"502", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(502) }, true},
		{"503", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(503) }, true},
		{"504", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(504) }, true},
		{"429", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(429) }, true},
		{"404", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(404) }, false},
		{"403", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(403) }, false},
		{"200 con basura", func(w http.ResponseWriter, _ *http.Request) {
			_, _ = w.Write([]byte("<html>mantenimiento</html>"))
		}, false},
		{"200 sin fecha", func(w http.ResponseWriter, _ *http.Request) {
			_, _ = w.Write([]byte(`{"venta":{"valor":450},"compra":{"valor":444}}`))
		}, false},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			srv := httptest.NewServer(c.handler)
			defer srv.Close()
			f := &FuenteHacienda{URL: srv.URL, URLEuro: srv.URL, Client: srv.Client()}

			_, err := f.Obtener(context.Background())
			if err == nil {
				t.Fatal("se esperaba error")
			}
			if got := esFallaPasajera(err); got != c.pasajera {
				t.Errorf("dolar: esFallaPasajera = %v, se esperaba %v (%v)", got, c.pasajera, err)
			}
			_, _, err = f.ObtenerEuro(context.Background())
			if err == nil {
				t.Fatal("se esperaba error en el euro")
			}
			if got := esFallaPasajera(err); got != c.pasajera {
				t.Errorf("euro: esFallaPasajera = %v, se esperaba %v (%v)", got, c.pasajera, err)
			}
		})
	}
}

func TestUnaRespuestaQueNoSirveEsErrorDeEntrada(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()
	a, buf := registroDelActualizador(&FuenteHacienda{URL: srv.URL, Client: srv.Client()})

	_ = a.ActualizarUnaVez(context.Background())

	if salida := buf.String(); !strings.Contains(salida, "level=ERROR") {
		t.Errorf("un 404 tiene que ser ERROR desde la primera pasada: %s", salida)
	}
}

// Una cifra fuera de rango llega con 200, bien formada: la rechaza la
// validacion, no la fuente, y sigue siendo ERROR.
func TestUnaCotizacionFueraDeRangoEsErrorDeEntrada(t *testing.T) {
	a, buf := registroDelActualizador(fuenteFija{c: &Cotizacion{Compra: 44422, Venta: 45006, Fecha: time.Now()}})

	_ = a.ActualizarUnaVez(context.Background())

	if salida := buf.String(); !strings.Contains(salida, "level=ERROR") {
		t.Errorf("una cotizacion fuera de rango tiene que ser ERROR: %s", salida)
	}
}

func TestNivelDeFalla(t *testing.T) {
	pasajera := fallaPasajera{errString("hacienda: HTTP 503")}
	otra := errString("hacienda: HTTP 404")
	casos := []struct {
		nombre   string
		err      error
		seguidas int
		quiere   slog.Level
	}{
		{"pasajera y corta", pasajera, 1, slog.LevelWarn},
		{"pasajera, a una del tope", pasajera, pasadasFallidasParaAlertar - 1, slog.LevelWarn},
		{"pasajera que ya no se va", pasajera, pasadasFallidasParaAlertar, slog.LevelError},
		{"pasajera muy larga", pasajera, 100, slog.LevelError},
		{"no pasajera, la primera vez", otra, 1, slog.LevelError},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			if got := nivelDeFalla(c.err, c.seguidas); got != c.quiere {
				t.Errorf("nivelDeFalla(%v, %d) = %v, se esperaba %v", c.err, c.seguidas, got, c.quiere)
			}
		})
	}
}

// Una falla que no se va deja de ser pasajera: dos dias de pasadas cada hora
// sin una sola confirmacion tienen que terminar en ERROR.
func TestUn503QueNoSeVaTerminaEnError(t *testing.T) {
	a, buf := registroDelActualizador(hacienda503(t))

	const pasadasEnDosDias = 48
	for i := 0; i < pasadasEnDosDias; i++ {
		_ = a.ActualizarUnaVez(context.Background())
	}

	lineas := strings.Split(strings.TrimSpace(buf.String()), "\n")
	if len(lineas) != pasadasEnDosDias {
		t.Fatalf("lineas = %d, se esperaba una por pasada (%d)", len(lineas), pasadasEnDosDias)
	}
	if !strings.Contains(lineas[0], "level=WARN") {
		t.Errorf("la primera pasada fallida tiene que ser WARN: %s", lineas[0])
	}
	if ultima := lineas[len(lineas)-1]; !strings.Contains(ultima, "level=ERROR") {
		t.Errorf("tras dos dias sin confirmar tiene que ser ERROR: %s", ultima)
	}
}
