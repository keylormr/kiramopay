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
