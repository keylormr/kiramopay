package country_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/kiramopay/backend/internal/country"
	"github.com/kiramopay/backend/internal/testutil"
)

// La fila guardada y /health tienen que decir de DONDE salio el tipo de cambio de
// esa pasada. Antes la palabra "hacienda" estaba escrita a mano en tres sitios:
// con el BCCR como fuente habria quedado dicha una mentira.

// fuenteVigente es la fuente de la fila vigente del par, la que se guarda en
// exchange_rates.
func fuenteVigente(t *testing.T, pool *pgxpool.Pool, desde, hacia string) string {
	t.Helper()
	var fuente string
	if err := pool.QueryRow(context.Background(), `
		SELECT source FROM exchange_rates
		 WHERE from_currency = $1 AND to_currency = $2 AND effective_to IS NULL`,
		desde, hacia).Scan(&fuente); err != nil {
		t.Fatalf("leer la fuente de %s/%s: %v", desde, hacia, err)
	}
	return fuente
}

func cotizacionDe(fuente string) *country.Cotizacion {
	return &country.Cotizacion{Compra: 444.22, Venta: 450.06, Fecha: hoy(), Fuente: fuente}
}

func TestLaFuenteGuardadaEsLaDelBCCRCuandoRespondeElBCCR(t *testing.T) {
	pool := testutil.TestDB(t)
	repo := country.NewRepository(pool)
	ctx := context.Background()

	// El euro sigue saliendo de Hacienda aunque el dolar salga del BCCR.
	f := &fuenteConEuro{
		fuente:         fuente{c: cotizacionDe("bccr")},
		dolaresPorEuro: 1.1252, fechaEuro: hoy(),
	}
	a := country.NewActualizador(repo, f, time.Hour, nil)
	if err := a.ActualizarUnaVez(ctx); err != nil {
		t.Fatalf("ActualizarUnaVez: %v", err)
	}

	for _, par := range [][2]string{{"USD", "CRC"}, {"CRC", "USD"}, {"PAB", "CRC"}, {"CRC", "PAB"}} {
		if got := fuenteVigente(t, pool, par[0], par[1]); got != "bccr" {
			t.Errorf("exchange_rates %s/%s: fuente %q, se esperaba bccr", par[0], par[1], got)
		}
	}
	if venta, origen, ok := ventaGuardada(t, pool, "CRC", hoy().Format(time.DateOnly)); !ok || venta != 450.06 || origen != "bccr" {
		t.Errorf("venta del dia: %v (%s, guardada %v); se esperaba 450.06 de bccr", venta, origen, ok)
	}
	if _, origen, ok := ventaGuardada(t, pool, "EUR", hoy().Format(time.DateOnly)); !ok || origen != "hacienda" {
		t.Errorf("el euro: fuente %q (guardado %v); el euro sigue saliendo de Hacienda", origen, ok)
	}
	if d := a.Diagnostico(); d.Fuente != "bccr" || d.UsdCrc != 450.06 || d.UltimoError != "" {
		t.Errorf("diagnostico = %+v, se esperaba bccr, 450.06 y ningun error", d)
	}
}

func TestLaFuenteGuardadaEsHaciendaCuandoElBCCRFallaYSeDiceLaFalla(t *testing.T) {
	pool := testutil.TestDB(t)
	repo := country.NewRepository(pool)
	ctx := context.Background()

	respaldo := cotizacionDe("hacienda")
	respaldo.FallaPrincipal = errors.New("bccr: HTTP 401")
	origen := &fuente{c: respaldo}
	a := country.NewActualizador(repo, origen, time.Hour, nil)
	if err := a.ActualizarUnaVez(ctx); err != nil {
		t.Fatalf("ActualizarUnaVez: %v", err)
	}

	if got := fuenteVigente(t, pool, "USD", "CRC"); got != "hacienda" {
		t.Errorf("exchange_rates USD/CRC: fuente %q, se esperaba hacienda", got)
	}
	if _, origen, ok := ventaGuardada(t, pool, "CRC", hoy().Format(time.DateOnly)); !ok || origen != "hacienda" {
		t.Errorf("venta del dia: fuente %q (guardada %v), se esperaba hacienda", origen, ok)
	}
	// La tasa vigente es buena, asi que cobrar sigue funcionando.
	if tasa, err := repo.TipoDeCambioParaCobrar(ctx, "USD", "CRC"); err != nil || tasa != 450.06 {
		t.Errorf("USD/CRC = %v (%v), se esperaba 450.06", tasa, err)
	}
	d := a.Diagnostico()
	if d.Fuente != "hacienda" || d.UsdCrc != 450.06 {
		t.Errorf("diagnostico = %+v, se esperaba hacienda y 450.06", d)
	}
	if !strings.Contains(d.UltimoError, "bccr") || !strings.Contains(d.UltimoError, "401") {
		t.Errorf("ultimo_error = %q, tiene que decir por que no se uso el BCCR", d.UltimoError)
	}

	// Cuando el BCCR vuelve, la fuente vuelve y el aviso se va.
	origen.c = cotizacionDe("bccr")
	if err := a.ActualizarUnaVez(ctx); err != nil {
		t.Fatalf("ActualizarUnaVez con el BCCR de vuelta: %v", err)
	}
	if got := fuenteVigente(t, pool, "USD", "CRC"); got != "bccr" {
		t.Errorf("exchange_rates USD/CRC: fuente %q, se esperaba bccr al volver el BCCR", got)
	}
	if d := a.Diagnostico(); d.Fuente != "bccr" || d.UltimoError != "" {
		t.Errorf("diagnostico = %+v, se esperaba bccr y sin error", d)
	}
}

// bccrDelDia responde el cuadro 1 con una cotizacion de hoy.
func bccrDelDia(t *testing.T) *country.FuenteBCCR {
	t.Helper()
	dia := hoy().Format(time.DateOnly)
	cuerpo := map[string]any{
		"estado": true, "mensaje": "",
		"datos": []any{map[string]any{"indicadores": []any{
			map[string]any{"codigoIndicador": "317", "series": []any{map[string]any{"fecha": dia, "valorDatoPorPeriodo": 444.22}}},
			map[string]any{"codigoIndicador": "318", "series": []any{map[string]any{"fecha": dia, "valorDatoPorPeriodo": 450.06}}},
		}}},
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(cuerpo)
	}))
	t.Cleanup(srv.Close)
	return &country.FuenteBCCR{URL: srv.URL, Token: "tok-de-prueba", Client: srv.Client()}
}

func bccrQueRechaza(t *testing.T, codigo int) *country.FuenteBCCR {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(codigo) }))
	t.Cleanup(srv.Close)
	return &country.FuenteBCCR{URL: srv.URL, Token: "tok-de-prueba", Client: srv.Client()}
}

// De punta a punta, con el BCCR en un servidor de prueba: lo que el BCCR publica
// es lo que queda guardado, con su nombre.
func TestDeCabeceraACabeceraElBCCRQuedaComoFuente(t *testing.T) {
	pool := testutil.TestDB(t)
	repo := country.NewRepository(pool)
	ctx := context.Background()

	dolar := &country.FuenteConRespaldo{Principal: bccrDelDia(t), Respaldo: &fuente{c: cotizacionDe("hacienda")}}
	a := country.NewActualizador(repo, dolar, time.Hour, nil)
	if err := a.ActualizarUnaVez(ctx); err != nil {
		t.Fatalf("ActualizarUnaVez: %v", err)
	}
	if got := fuenteVigente(t, pool, "USD", "CRC"); got != "bccr" {
		t.Errorf("exchange_rates USD/CRC: fuente %q, se esperaba bccr", got)
	}
	if d := a.Diagnostico(); d.Fuente != "bccr" || d.UsdCrc != 450.06 || d.Compra != 444.22 {
		t.Errorf("diagnostico = %+v, se esperaba bccr 450.06 / 444.22", d)
	}
}

func TestDeCabeceraACabeceraUnBCCRCaidoDejaAHacienda(t *testing.T) {
	pool := testutil.TestDB(t)
	repo := country.NewRepository(pool)
	ctx := context.Background()

	dolar := &country.FuenteConRespaldo{Principal: bccrQueRechaza(t, http.StatusUnauthorized), Respaldo: &fuente{c: cotizacionDe("hacienda")}}
	a := country.NewActualizador(repo, dolar, time.Hour, nil)
	if err := a.ActualizarUnaVez(ctx); err != nil {
		t.Fatalf("con Hacienda de respaldo la pasada no falla: %v", err)
	}
	if got := fuenteVigente(t, pool, "USD", "CRC"); got != "hacienda" {
		t.Errorf("exchange_rates USD/CRC: fuente %q, se esperaba hacienda", got)
	}
	d := a.Diagnostico()
	if d.Fuente != "hacienda" || !strings.Contains(d.UltimoError, "401") {
		t.Errorf("diagnostico = %+v, se esperaba hacienda con el 401 del BCCR en ultimo_error", d)
	}
}

func registroEnBuffer() (*slog.Logger, *bytes.Buffer) {
	var buf bytes.Buffer
	return slog.New(slog.NewTextHandler(&buf, &slog.HandlerOptions{Level: slog.LevelDebug})), &buf
}

// El respaldo que cubre una falla del BCCR no la esconde: un token rechazado es
// ERROR (no se arregla esperando) y un 503 del BCCR es WARN (si).
func TestElRespaldoNoEscondeLaFallaDelBCCR(t *testing.T) {
	casos := []struct {
		nombre string
		codigo int
		nivel  string
		noDebe string
	}{
		{"token rechazado", http.StatusUnauthorized, "level=ERROR", ""},
		{"ruta equivocada", http.StatusNotFound, "level=ERROR", ""},
		{"503 pasajero", http.StatusServiceUnavailable, "level=WARN", "level=ERROR"},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			pool := testutil.TestDB(t)
			repo := country.NewRepository(pool)
			logger, buf := registroEnBuffer()

			dolar := &country.FuenteConRespaldo{Principal: bccrQueRechaza(t, c.codigo), Respaldo: &fuente{c: cotizacionDe("hacienda")}}
			a := country.NewActualizador(repo, dolar, time.Hour, logger)
			if err := a.ActualizarUnaVez(context.Background()); err != nil {
				t.Fatalf("ActualizarUnaVez: %v", err)
			}
			salida := buf.String()
			if !strings.Contains(salida, c.nivel) {
				t.Errorf("se esperaba %s en el registro: %s", c.nivel, salida)
			}
			if c.noDebe != "" && strings.Contains(salida, c.noDebe) {
				t.Errorf("no se esperaba %s en el registro: %s", c.noDebe, salida)
			}
			if strings.Contains(salida, "tok-de-prueba") {
				t.Errorf("el token quedo escrito en el registro: %s", salida)
			}
		})
	}
}
