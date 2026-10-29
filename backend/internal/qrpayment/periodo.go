package qrpayment

import "time"

// Periodo es una ventana de tiempo que la pantalla del comercio ofrece: hoy, los
// ultimos 7 dias, lo que va del mes y el mes anterior. Se cuenta en dias de
// calendario de la zona de quien mira (tz), igual que el reporte, y la decide el
// servidor: la pantalla no filtra lo que ya tenia, lo pide.
type Periodo string

const (
	PeriodoHoy         Periodo = "today"
	PeriodoSemana      Periodo = "week"       // los ultimos 7 dias, hoy incluido
	PeriodoMes         Periodo = "month"      // del dia 1 hasta ahora
	PeriodoMesAnterior Periodo = "prev_month" // el mes anterior, entero
)

// periodosDelResumen es el orden en que el resumen entrega los periodos.
var periodosDelResumen = []Periodo{PeriodoHoy, PeriodoSemana, PeriodoMes, PeriodoMesAnterior}

// ParsePeriodo acepta solo los cuatro valores que la pantalla ofrece, escritos
// tal cual. Cualquier otro es un error del cliente, no un periodo por defecto.
func ParsePeriodo(s string) (Periodo, bool) {
	switch p := Periodo(s); p {
	case PeriodoHoy, PeriodoSemana, PeriodoMes, PeriodoMesAnterior:
		return p, true
	}
	return "", false
}

// ventanaDePeriodo son los instantes de un periodo y de su periodo anterior.
// Ambos son intervalos [desde, hasta): el limite superior queda fuera, de modo
// que el mes anterior termina donde empieza este sin pisarse.
type ventanaDePeriodo struct {
	periodo Periodo
	zona    *time.Location
	// dias es cuantos dias de calendario abarca (el reporte lo informa).
	dias                         int
	desde, hasta                 time.Time
	anteriorDesde, anteriorHasta time.Time
}

// calcularVentanaDePeriodo arma el periodo y el que se le compara.
//
// El periodo anterior es de igual forma y llega hasta la misma hora, para no
// comparar un dia a medias con uno entero:
//
//   - hoy contra ayer, hasta la misma hora;
//   - 7 dias contra los 7 anteriores, hasta la misma hora;
//   - este mes contra el mes pasado hasta el mismo dia y hora. Si el mes pasado
//     fue mas corto (el 31 de octubre contra septiembre), se compara con el mes
//     entero y no se desborda hacia este;
//   - el mes anterior, entero, contra el mes de antes, entero.
//
// tzOffsetMin son los minutos al OESTE de UTC que da getTimezoneOffset() de JS
// (Costa Rica = 360). Uno fuera de rango vuelve a UTC, como en el reporte.
func calcularVentanaDePeriodo(ahora time.Time, p Periodo, tzOffsetMin int) ventanaDePeriodo {
	zona := time.FixedZone("client", -sanearDesfase(tzOffsetMin)*60)
	local := ahora.In(zona)
	medianoche := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, zona)
	inicioDeMes := time.Date(local.Year(), local.Month(), 1, 0, 0, 0, 0, zona)

	v := ventanaDePeriodo{periodo: p, zona: zona, hasta: local}
	switch p {
	case PeriodoSemana:
		v.dias = 7
		v.desde = medianoche.AddDate(0, 0, -6)
		v.anteriorDesde = v.desde.AddDate(0, 0, -7)
		v.anteriorHasta = local.AddDate(0, 0, -7)
	case PeriodoMes:
		v.dias = local.Day()
		v.desde = inicioDeMes
		v.anteriorDesde = inicioDeMes.AddDate(0, -1, 0)
		// El mismo dia y hora del mes pasado. Si ese mes no tiene ese dia, Go
		// lo desborda hacia este mes: se corta donde empieza este.
		mismoPunto := time.Date(local.Year(), local.Month()-1, local.Day(),
			local.Hour(), local.Minute(), local.Second(), local.Nanosecond(), zona)
		if mismoPunto.After(inicioDeMes) {
			mismoPunto = inicioDeMes
		}
		v.anteriorHasta = mismoPunto
	case PeriodoMesAnterior:
		v.desde = inicioDeMes.AddDate(0, -1, 0)
		v.hasta = inicioDeMes
		v.dias = diasDelMes(v.desde)
		v.anteriorDesde = v.desde.AddDate(0, -1, 0)
		v.anteriorHasta = v.desde
	default: // PeriodoHoy
		v.dias = 1
		v.desde = medianoche
		v.anteriorDesde = medianoche.AddDate(0, 0, -1)
		v.anteriorHasta = local.AddDate(0, 0, -1)
	}
	return v
}

// sanearDesfase deja un desfase fuera de rango en cero (UTC).
func sanearDesfase(tzOffsetMin int) int {
	if tzOffsetMin < -840 || tzOffsetMin > 840 {
		return 0
	}
	return tzOffsetMin
}

// diasDelMes es cuantos dias tiene el mes del instante dado.
func diasDelMes(t time.Time) int {
	return time.Date(t.Year(), t.Month()+1, 0, 0, 0, 0, 0, t.Location()).Day()
}

// diaInclusivo es el ultimo dia que toca una ventana cuyo limite superior queda
// fuera: el mes anterior, que termina a las 00:00 del dia 1, termina el dia 30
// o 31 del mes anterior.
func diaInclusivo(hastaExclusivo time.Time) string {
	return hastaExclusivo.Add(-time.Nanosecond).Format(formatoDia)
}

func (v ventanaDePeriodo) primerDia() string         { return v.desde.Format(formatoDia) }
func (v ventanaDePeriodo) ultimoDia() string         { return diaInclusivo(v.hasta) }
func (v ventanaDePeriodo) primerDiaAnterior() string { return v.anteriorDesde.Format(formatoDia) }
func (v ventanaDePeriodo) ultimoDiaAnterior() string { return diaInclusivo(v.anteriorHasta) }

// comoVentanaDeReporte la pasa a la forma que arma el reporte. Acotada: sus
// consultas cortan en `hasta`, porque el mes anterior no llega hasta ahora.
func (v ventanaDePeriodo) comoVentanaDeReporte() ventanaReporte {
	return ventanaReporte{
		dias:          v.dias,
		desde:         v.desde,
		hasta:         v.hasta,
		anteriorDesde: v.anteriorDesde,
		anteriorHasta: v.anteriorHasta,
		acotada:       true,
	}
}

// anclarAhora fija el "ahora" de un periodo. Un comercio cerrado ya no vende:
// sus periodos se cuentan desde el dia que cerro, como el reporte.
func anclarAhora(m *Merchant, ahora time.Time) time.Time {
	if m != nil && m.ClosedAt != nil && m.ClosedAt.Before(ahora) {
		return *m.ClosedAt
	}
	return ahora
}
