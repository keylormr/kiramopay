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
