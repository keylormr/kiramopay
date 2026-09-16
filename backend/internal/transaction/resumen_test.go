package transaction

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/kiramopay/backend/internal/middleware"
)

// El resumen corta los dias en hora de Costa Rica y compara contra created_at,
// que se escribe en UTC. Si los bordes salieran en hora local sin convertir, un
// gasto hecho a las 11 p. m. del 31 de julio contaria para agosto.
func TestParseRangoResumen_BordesEnUTCDesdeLaHoraDeCostaRica(t *testing.T) {
	r, err := ParseRangoResumen("2026-08-01", "2026-09-01")
	if err != nil {
		t.Fatalf("rango valido rechazado: %v", err)
	}

	inicio := time.Date(2026, 8, 1, 6, 0, 0, 0, time.UTC)
	fin := time.Date(2026, 9, 1, 6, 0, 0, 0, time.UTC)
	if !r.Inicio.Equal(inicio) || r.Inicio.Location() != time.UTC {
		t.Errorf("Inicio = %v, esperaba %v en UTC (medianoche de Costa Rica)", r.Inicio, inicio)
	}
	if !r.Fin.Equal(fin) || r.Fin.Location() != time.UTC {
		t.Errorf("Fin = %v, esperaba %v en UTC", r.Fin, fin)
	}
	if r.DesfaseSegundos != -6*3600 {
		t.Errorf("DesfaseSegundos = %d, esperaba -21600", r.DesfaseSegundos)
	}

	// La poda de particiones lleva un dia de margen a cada lado: created_date se
	// escribe con la fecha del servidor, no con la de Costa Rica.
	if got := r.ParticionDesde.Format("2006-01-02"); got != "2026-07-31" {
		t.Errorf("ParticionDesde = %s, esperaba 2026-07-31", got)
	}
	if got := r.ParticionHasta.Format("2006-01-02"); got != "2026-09-02" {
		t.Errorf("ParticionHasta = %s, esperaba 2026-09-02", got)
	}
	if r.Desde != "2026-08-01" || r.Hasta != "2026-09-01" {
		t.Errorf("Desde/Hasta = %s/%s, deben devolverse tal cual llegaron", r.Desde, r.Hasta)
	}
}

func TestParseRangoResumen_RechazaLoQueNoEsUnRangoDeDias(t *testing.T) {
	casos := map[string][2]string{
		"sin desde":             {"", "2026-09-01"},
		"sin hasta":             {"2026-08-01", ""},
		"con hora":              {"2026-08-01T00:00:00Z", "2026-09-01"},
		"fecha imposible":       {"2026-02-30", "2026-03-01"},
		"hasta igual a desde":   {"2026-08-01", "2026-08-01"},
		"hasta antes que desde": {"2026-09-01", "2026-08-01"},
		"mas de dos anos":       {"2024-01-01", "2026-01-03"},
	}
	for nombre, c := range casos {
		if _, err := ParseRangoResumen(c[0], c[1]); !errors.Is(err, ErrRangoResumen) {
			t.Errorf("%s (%q, %q): err = %v, esperaba ErrRangoResumen", nombre, c[0], c[1], err)
		}
	}

	// Un dia suelto es un rango valido: desde incluido, hasta excluido.
	if _, err := ParseRangoResumen("2026-08-15", "2026-08-16"); err != nil {
		t.Errorf("un dia suelto fue rechazado: %v", err)
	}
	// Y el tope exacto tambien entra.
	if _, err := ParseRangoResumen("2024-01-01", "2026-01-02"); err != nil {
		t.Errorf("un rango de %d dias fue rechazado: %v", maxDiasResumen, err)
	}
}

// El numero de dia lo calcula la base sumando el desfase al instante. Aqui se
// comprueba la vuelta a fecha, incluidos los bordes del dia en Costa Rica.
func TestFechaDeDiaEpoch_DiaCivilDeCostaRica(t *testing.T) {
	desfase := int64(-6 * 3600)
	dia := func(t time.Time) int64 {
		s := t.Unix() + desfase
		if s < 0 {
			return (s - 86399) / 86400
		}
		return s / 86400
	}
	casos := []struct {
		instante time.Time
		fecha    string
	}{
		{time.Date(2026, 8, 1, 5, 59, 59, 0, time.UTC), "2026-07-31"},
		{time.Date(2026, 8, 1, 6, 0, 0, 0, time.UTC), "2026-08-01"},
		{time.Date(2026, 9, 1, 5, 30, 0, 0, time.UTC), "2026-08-31"},
	}
	for _, c := range casos {
		if got := fechaDeDiaEpoch(dia(c.instante)); got != c.fecha {
			t.Errorf("%v cae en %s, esperaba %s", c.instante, got, c.fecha)
		}
	}
}

// La validacion corre ANTES de tocar la base: un rango malo responde 400 aunque
// el servicio no exista, y sin sesion no se llega ni a validar.
func TestSummary_ValidaAntesDeConsultar(t *testing.T) {
	h := &Handler{} // sin servicio: si el handler lo usara, la prueba entraria en panico

	req := httptest.NewRequest(http.MethodGet, "/api/v1/transactions/summary?from=2026-08-01&to=2026-08-01", nil)
	req = req.WithContext(context.WithValue(req.Context(), middleware.UserIDKey, "u1"))
	rec := httptest.NewRecorder()
	h.Summary(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("rango vacio: status %d, esperaba 400", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "VALIDATION_ERROR") {
		t.Errorf("el cuerpo no dice VALIDATION_ERROR: %s", rec.Body.String())
	}

	sinSesion := httptest.NewRequest(http.MethodGet, "/api/v1/transactions/summary?from=2026-08-01&to=2026-09-01", nil)
	rec = httptest.NewRecorder()
	h.Summary(rec, sinSesion)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("sin sesion: status %d, esperaba 401", rec.Code)
	}
}
