package country

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// La forma exacta que devolvio api.hacienda.go.cr el 2026-09-11.
const respuestaHacienda = `{
  "venta": {"fecha": "2026-09-11", "valor": 450.06},
  "compra": {"fecha": "2026-09-11", "valor": 444.22}
}`

func TestFuenteHaciendaLeeLaRespuestaReal(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(respuestaHacienda))
	}))
	defer srv.Close()

	f := &FuenteHacienda{URL: srv.URL, Client: srv.Client()}
	c, err := f.Obtener(context.Background())
	if err != nil {
		t.Fatalf("Obtener: %v", err)
	}
	if c.Venta != 450.06 || c.Compra != 444.22 {
		t.Fatalf("cotizacion = %+v, se esperaba compra 444.22 / venta 450.06", c)
	}
	if c.Fecha.Format("2006-01-02") != "2026-09-11" {
		t.Fatalf("fecha = %s", c.Fecha)
	}
}

func TestFuenteHaciendaNoInventaUnaCotizacion(t *testing.T) {
	casos := map[string]http.HandlerFunc{
		"caida": func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusServiceUnavailable)
		},
		"basura": func(w http.ResponseWriter, _ *http.Request) {
			_, _ = w.Write([]byte("<html>mantenimiento</html>"))
		},
		"sin fecha": func(w http.ResponseWriter, _ *http.Request) {
			_, _ = w.Write([]byte(`{"venta":{"valor":450},"compra":{"valor":444}}`))
		},
	}
	for nombre, h := range casos {
		t.Run(nombre, func(t *testing.T) {
			srv := httptest.NewServer(h)
			defer srv.Close()
			f := &FuenteHacienda{URL: srv.URL, Client: srv.Client()}
			if c, err := f.Obtener(context.Background()); err == nil {
				t.Fatalf("se esperaba error y devolvio %+v", c)
			}
		})
	}
}

// La cifra termina cobrando: lo que no puede ser un tipo de cambio del colon no
// pasa, venga de donde venga.
func TestValidarCotizacionAtajaLaBasura(t *testing.T) {
	hoy := time.Date(2026, 9, 11, 12, 0, 0, 0, time.UTC)
	fecha := time.Date(2026, 9, 11, 0, 0, 0, 0, time.UTC)

	if err := validarCotizacion(&Cotizacion{Compra: 444.22, Venta: 450.06, Fecha: fecha}, hoy); err != nil {
		t.Fatalf("la cotizacion real del dia fue rechazada: %v", err)
	}

	malas := map[string]*Cotizacion{
		"cero":                  {Compra: 0, Venta: 0, Fecha: fecha},
		"separador decimal":     {Compra: 44422, Venta: 45006, Fecha: fecha},
		"invertida":             {Compra: 450.06, Venta: 444.22, Fecha: fecha},
		"diferencia anormal":    {Compra: 300, Venta: 450, Fecha: fecha},
		"fuente muerta":         {Compra: 444.22, Venta: 450.06, Fecha: hoy.AddDate(0, 0, -8)},
		"cotizacion inexistente": nil,
	}
	for nombre, c := range malas {
		if err := validarCotizacion(c, hoy); err == nil {
			t.Errorf("%s: se esperaba rechazo", nombre)
		}
	}
}

// Un fin de semana largo no deja la tasa "vieja": la fuente la sigue
// confirmando aunque no se mueva.
func TestUnFinDeSemanaLargoNoVenceLaCotizacion(t *testing.T) {
	viernes := time.Date(2026, 9, 11, 0, 0, 0, 0, time.UTC)
	martesTemprano := viernes.Add(3*24*time.Hour + 6*time.Hour)
	if err := validarCotizacion(&Cotizacion{Compra: 444, Venta: 450, Fecha: viernes}, martesTemprano); err != nil {
		t.Fatalf("una cotizacion del viernes el martes temprano fue rechazada: %v", err)
	}
}

func TestCambioSignificativo(t *testing.T) {
	if cambioSignificativo(450.06, 450.06) {
		t.Error("la misma tasa no es un cambio")
	}
	// 1/venta guardado en NUMERIC(20,10) y vuelto a leer no es identico.
	if cambioSignificativo(1/450.06, 0.0022219259) {
		t.Error("el redondeo del NUMERIC no es un cambio")
	}
	if !cambioSignificativo(515, 450.06) {
		t.Error("de 515 a 450,06 si es un cambio")
	}
	if !cambioSignificativo(0, 450.06) {
		t.Error("sin tasa previa, cualquier tasa es nueva")
	}
}

// El diagnostico guarda el ultimo error sin perder la ultima tasa buena: es lo
// que se publica en /health.
func TestElDiagnosticoConservaLaUltimaTasaBuena(t *testing.T) {
	a := NewActualizador(nil, fuenteFija{err: errString("hacienda: HTTP 503")}, time.Hour, nil)
	a.estado = DiagnosticoTipoDeCambio{Fuente: "hacienda", UsdCrc: 450.06}

	if err := a.ActualizarUnaVez(context.Background()); err == nil {
		t.Fatal("una fuente caida tiene que devolver error")
	}
	d := a.Diagnostico()
	if d.UsdCrc != 450.06 {
		t.Fatalf("usd_crc = %v, se perdio la ultima tasa buena", d.UsdCrc)
	}
	if !strings.Contains(d.UltimoError, "503") {
		t.Fatalf("ultimo_error = %q, se esperaba el 503", d.UltimoError)
	}
}

type errString string

func (e errString) Error() string { return string(e) }

type fuenteFija struct {
	c   *Cotizacion
	err error
}

func (f fuenteFija) Obtener(context.Context) (*Cotizacion, error) { return f.c, f.err }
