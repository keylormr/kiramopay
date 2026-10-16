package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/cors"
)

const origenDePrueba = "https://kiramopay.com"

func preflight(t *testing.T, cabecerasPedidas string) *httptest.ResponseRecorder {
	t.Helper()
	h := cors.Handler(opcionesCORS([]string{origenDePrueba}))(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatalf("un preflight no debe llegar al handler de la ruta")
	}))
	req := httptest.NewRequest(http.MethodOptions, "/api/v1/savings/goals/x/deposit", nil)
	req.Header.Set("Origin", origenDePrueba)
	req.Header.Set("Access-Control-Request-Method", http.MethodPost)
	req.Header.Set("Access-Control-Request-Headers", cabecerasPedidas)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

// Toda cabecera que el frontend manda entre dominios tiene que pasar el
// preflight. Con una sola que falte, el navegador bloquea la peticion entera.
func TestElPreflightAceptaLasCabecerasQueMandaElFrontend(t *testing.T) {
	casos := []string{
		"authorization,content-type",
		// Deposito y retiro de metas de ahorro (savings.http.ts).
		"idempotency-key,content-type,authorization",
		"accept",
	}
	for _, pedidas := range casos {
		rec := preflight(t, pedidas)
		if got := rec.Header().Get("Access-Control-Allow-Origin"); got != origenDePrueba {
			t.Errorf("preflight pidiendo %q: Access-Control-Allow-Origin=%q, se esperaba %q", pedidas, got, origenDePrueba)
			continue
		}
		permitidas := strings.ToLower(rec.Header().Get("Access-Control-Allow-Headers"))
		for _, c := range strings.Split(pedidas, ",") {
			if !strings.Contains(permitidas, strings.TrimSpace(c)) {
				t.Errorf("preflight pidiendo %q: falta %q en Access-Control-Allow-Headers=%q", pedidas, c, permitidas)
			}
		}
	}
}

// Control negativo: demuestra que la prueba de arriba no pasa por accidente.
// Una cabecera fuera de la lista deja el preflight SIN Access-Control-Allow-Origin,
// que es exactamente el sintoma que tenia Idempotency-Key.
func TestUnaCabeceraNoPermitidaDejaElPreflightSinCORS(t *testing.T) {
	rec := preflight(t, "x-cabecera-que-nadie-permitio,content-type")
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Fatalf("una cabecera no permitida deberia abortar el preflight; Access-Control-Allow-Origin=%q", got)
	}
}

// La app lee el nombre del archivo de Content-Disposition: el reporte CSV del
// comercio sale con el nombre en el idioma de la app. En una peticion entre
// dominios (kiramopay.com -> api.kiramopay.com, y la app Android) el navegador
// solo deja leer las cabeceras expuestas, y esta no lo estaba: el nombre
// llegaba vacio y la app usaba uno fijo en espanol.
func TestLaRespuestaExponeContentDisposition(t *testing.T) {
	h := cors.Handler(opcionesCORS([]string{origenDePrueba}))(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Disposition", `attachment; filename="report-2026-10-01-to-2026-10-14.csv"`)
		w.WriteHeader(http.StatusOK)
	}))
	req := httptest.NewRequest(http.MethodGet, "/api/v1/qr/merchants/m1/report.csv?days=14&lang=en", nil)
	req.Header.Set("Origin", origenDePrueba)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	expuestas := strings.ToLower(rec.Header().Get("Access-Control-Expose-Headers"))
	if !strings.Contains(expuestas, "content-disposition") {
		t.Fatalf("Access-Control-Expose-Headers=%q: falta Content-Disposition", expuestas)
	}
	// La que ya estaba sigue estando.
	if !strings.Contains(expuestas, "link") {
		t.Fatalf("Access-Control-Expose-Headers=%q: se perdio Link", expuestas)
	}
}
