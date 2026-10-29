package qrpayment

import (
	"testing"
	"time"
)

// Los periodos de la interfaz del comercio (hoy, 7 dias, este mes, mes
// anterior) se cuentan en dias de calendario de la zona de quien mira, igual
// que el reporte: tz son los minutos al OESTE de UTC que da getTimezoneOffset()
// (Costa Rica = 360).

func instante(t *testing.T, texto string) time.Time {
	t.Helper()
	v, err := time.Parse(time.RFC3339, texto)
	if err != nil {
		t.Fatalf("instante %q: %v", texto, err)
	}
	return v
}

type esperadoDeVentana struct {
	dias                         int
	desde, hasta                 string
	anteriorDesde, anteriorHasta string
	ultimoDia                    string
}

func comprobarVentana(t *testing.T, nombre string, v ventanaDePeriodo, quiero esperadoDeVentana) {
	t.Helper()
	if v.dias != quiero.dias {
		t.Errorf("%s: dias = %d, se esperaba %d", nombre, v.dias, quiero.dias)
	}
	for campo, par := range map[string][2]any{
		"desde":         {v.desde, quiero.desde},
		"hasta":         {v.hasta, quiero.hasta},
		"anteriorDesde": {v.anteriorDesde, quiero.anteriorDesde},
		"anteriorHasta": {v.anteriorHasta, quiero.anteriorHasta},
	} {
		obtenido := par[0].(time.Time)
		esperado := instante(t, par[1].(string))
		if !obtenido.Equal(esperado) {
			t.Errorf("%s: %s = %s, se esperaba %s", nombre, campo, obtenido.UTC().Format(time.RFC3339), esperado.UTC().Format(time.RFC3339))
		}
	}
	if got := v.ultimoDia(); got != quiero.ultimoDia {
		t.Errorf("%s: ultimoDia = %s, se esperaba %s", nombre, got, quiero.ultimoDia)
	}
}

func TestParsePeriodo(t *testing.T) {
	for _, bueno := range []string{"today", "week", "month", "prev_month"} {
		if p, ok := ParsePeriodo(bueno); !ok || string(p) != bueno {
			t.Errorf("ParsePeriodo(%q) = %q, %v; se esperaba aceptarlo", bueno, p, ok)
		}
	}
	for _, malo := range []string{"", "year", "TODAY", "7d", "last_month", " today", "month;"} {
		if p, ok := ParsePeriodo(malo); ok {
			t.Errorf("ParsePeriodo(%q) = %q; un periodo que la pantalla no ofrece no se acepta", malo, p)
		}
	}
}

func TestVentanaDePeriodo_CostaRica(t *testing.T) {
	// 29-10-2026 15:30 UTC son las 09:30 en Costa Rica.
	ahora := instante(t, "2026-10-29T15:30:00Z")

	comprobarVentana(t, "hoy", calcularVentanaDePeriodo(ahora, PeriodoHoy, 360), esperadoDeVentana{
		dias: 1, desde: "2026-10-29T06:00:00Z", hasta: "2026-10-29T15:30:00Z",
		// Ayer, hasta la misma hora: un dia a medias no se compara con uno entero.
		anteriorDesde: "2026-10-28T06:00:00Z", anteriorHasta: "2026-10-28T15:30:00Z",
		ultimoDia: "2026-10-29",
	})
	comprobarVentana(t, "7 dias", calcularVentanaDePeriodo(ahora, PeriodoSemana, 360), esperadoDeVentana{
		dias: 7, desde: "2026-10-23T06:00:00Z", hasta: "2026-10-29T15:30:00Z",
		anteriorDesde: "2026-10-16T06:00:00Z", anteriorHasta: "2026-10-22T15:30:00Z",
		ultimoDia: "2026-10-29",
	})
	comprobarVentana(t, "este mes", calcularVentanaDePeriodo(ahora, PeriodoMes, 360), esperadoDeVentana{
		dias: 29, desde: "2026-10-01T06:00:00Z", hasta: "2026-10-29T15:30:00Z",
		// Lo que va del mes contra lo que iba el mes pasado al mismo dia y hora.
		anteriorDesde: "2026-09-01T06:00:00Z", anteriorHasta: "2026-09-29T15:30:00Z",
		ultimoDia: "2026-10-29",
	})
	comprobarVentana(t, "mes anterior", calcularVentanaDePeriodo(ahora, PeriodoMesAnterior, 360), esperadoDeVentana{
		// El mes anterior es entero: termina donde empieza este, y ese limite
		// queda fuera.
		dias: 30, desde: "2026-09-01T06:00:00Z", hasta: "2026-10-01T06:00:00Z",
		anteriorDesde: "2026-08-01T06:00:00Z", anteriorHasta: "2026-09-01T06:00:00Z",
		ultimoDia: "2026-09-30",
	})
}

// Pasada la medianoche en UTC todavia es el dia anterior en Costa Rica: las
// 22:00 del 31 de octubre no son noviembre.
func TestVentanaDePeriodo_ElDiaEsDeQuienMiraNoDeUTC(t *testing.T) {
	ahora := instante(t, "2026-11-01T04:00:00Z") // 31-10-2026 22:00 en Costa Rica

	comprobarVentana(t, "hoy", calcularVentanaDePeriodo(ahora, PeriodoHoy, 360), esperadoDeVentana{
		dias: 1, desde: "2026-10-31T06:00:00Z", hasta: "2026-11-01T04:00:00Z",
		anteriorDesde: "2026-10-30T06:00:00Z", anteriorHasta: "2026-10-31T04:00:00Z",
		ultimoDia: "2026-10-31",
	})
	// El 31 de octubre contra septiembre, que solo tiene 30 dias: el mes
	// anterior se compara entero, no se desborda hacia octubre.
	comprobarVentana(t, "este mes", calcularVentanaDePeriodo(ahora, PeriodoMes, 360), esperadoDeVentana{
		dias: 31, desde: "2026-10-01T06:00:00Z", hasta: "2026-11-01T04:00:00Z",
		anteriorDesde: "2026-09-01T06:00:00Z", anteriorHasta: "2026-10-01T06:00:00Z",
		ultimoDia: "2026-10-31",
	})
	comprobarVentana(t, "mes anterior", calcularVentanaDePeriodo(ahora, PeriodoMesAnterior, 360), esperadoDeVentana{
		dias: 30, desde: "2026-09-01T06:00:00Z", hasta: "2026-10-01T06:00:00Z",
		anteriorDesde: "2026-08-01T06:00:00Z", anteriorHasta: "2026-09-01T06:00:00Z",
		ultimoDia: "2026-09-30",
	})
}

func TestVentanaDePeriodo_PrimerDiaDelMes(t *testing.T) {
	ahora := instante(t, "2026-11-01T07:00:00Z") // 01-11-2026 01:00 en Costa Rica

	comprobarVentana(t, "este mes", calcularVentanaDePeriodo(ahora, PeriodoMes, 360), esperadoDeVentana{
		dias: 1, desde: "2026-11-01T06:00:00Z", hasta: "2026-11-01T07:00:00Z",
		anteriorDesde: "2026-10-01T06:00:00Z", anteriorHasta: "2026-10-01T07:00:00Z",
		ultimoDia: "2026-11-01",
	})
	comprobarVentana(t, "mes anterior", calcularVentanaDePeriodo(ahora, PeriodoMesAnterior, 360), esperadoDeVentana{
		dias: 31, desde: "2026-10-01T06:00:00Z", hasta: "2026-11-01T06:00:00Z",
		anteriorDesde: "2026-09-01T06:00:00Z", anteriorHasta: "2026-10-01T06:00:00Z",
		ultimoDia: "2026-10-31",
	})
}

func TestVentanaDePeriodo_ElMesAnteriorDeEneroEsDiciembre(t *testing.T) {
	ahora := instante(t, "2027-01-10T18:00:00Z") // 10-01-2027 12:00 en Costa Rica

	comprobarVentana(t, "mes anterior", calcularVentanaDePeriodo(ahora, PeriodoMesAnterior, 360), esperadoDeVentana{
		dias: 31, desde: "2026-12-01T06:00:00Z", hasta: "2027-01-01T06:00:00Z",
		anteriorDesde: "2026-11-01T06:00:00Z", anteriorHasta: "2026-12-01T06:00:00Z",
		ultimoDia: "2026-12-31",
	})
	comprobarVentana(t, "este mes", calcularVentanaDePeriodo(ahora, PeriodoMes, 360), esperadoDeVentana{
		dias: 10, desde: "2027-01-01T06:00:00Z", hasta: "2027-01-10T18:00:00Z",
		anteriorDesde: "2026-12-01T06:00:00Z", anteriorHasta: "2026-12-10T18:00:00Z",
		ultimoDia: "2027-01-10",
	})
}

func TestVentanaDePeriodo_OtraZonaHoraria(t *testing.T) {
	// Japon (UTC+9): getTimezoneOffset() = -540. 29-10-2026 20:00 UTC es el
	// 30-10-2026 05:00 alla.
	ahora := instante(t, "2026-10-29T20:00:00Z")
	comprobarVentana(t, "hoy en Japon", calcularVentanaDePeriodo(ahora, PeriodoHoy, -540), esperadoDeVentana{
		dias: 1, desde: "2026-10-29T15:00:00Z", hasta: "2026-10-29T20:00:00Z",
		anteriorDesde: "2026-10-28T15:00:00Z", anteriorHasta: "2026-10-28T20:00:00Z",
		ultimoDia: "2026-10-30",
	})
}

// Un desfase fuera de rango vuelve a UTC, como en el reporte.
func TestVentanaDePeriodo_UnDesfaseFueraDeRangoEsUTC(t *testing.T) {
	ahora := instante(t, "2026-10-29T15:30:00Z")
	comprobarVentana(t, "hoy", calcularVentanaDePeriodo(ahora, PeriodoHoy, 9999), esperadoDeVentana{
		dias: 1, desde: "2026-10-29T00:00:00Z", hasta: "2026-10-29T15:30:00Z",
		anteriorDesde: "2026-10-28T00:00:00Z", anteriorHasta: "2026-10-28T15:30:00Z",
		ultimoDia: "2026-10-29",
	})
}

// Los cuatro periodos son consecutivos y no se pisan: lo que se vendio en un
// instante cae en uno solo de "mes anterior" y "este mes".
func TestVentanaDePeriodo_ElMesAnteriorYEsteMesNoSePisan(t *testing.T) {
	ahora := instante(t, "2026-10-29T15:30:00Z")
	este := calcularVentanaDePeriodo(ahora, PeriodoMes, 360)
	previo := calcularVentanaDePeriodo(ahora, PeriodoMesAnterior, 360)
	if !previo.hasta.Equal(este.desde) {
		t.Fatalf("el mes anterior termina en %v y este mes empieza en %v", previo.hasta, este.desde)
	}
}
