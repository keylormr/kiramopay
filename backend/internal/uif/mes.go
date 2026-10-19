package uif

import "time"

// El periodo de las transacciones multiples es el MES CALENDARIO (SUGEF 13-19,
// art. 20), y el mes es el de Costa Rica: lo que una persona hace a las 8 de
// la noche del 31 es del mes que termina, aunque en UTC ya sea el 1.
//
// Costa Rica es UTC-6 todo el ano: no aplica horario de verano desde 1992. Se
// usa el desfase fijo y no la base de zonas, que el sistema puede no traer, y
// el dia que se corta en SQL usa la misma cuenta (ver sqlMovimientosPorDia).
const desfaseCR = -6 * 3600

var zonaCR = time.FixedZone("CR", desfaseCR)

// diaCR es la fecha civil de Costa Rica de un instante, como medianoche UTC de
// esa fecha: asi dos fechas se restan en dias sin depender de ninguna zona.
func diaCR(t time.Time) time.Time {
	l := t.In(zonaCR)
	return time.Date(l.Year(), l.Month(), l.Day(), 0, 0, 0, 0, time.UTC)
}

// diasEntre cuenta los dias naturales de `desde` a `hasta`, dos fechas civiles
// de diaCR.
func diasEntre(desde, hasta time.Time) int {
	return int(hasta.Sub(desde).Hours() / 24)
}

// Mes es un mes calendario de Costa Rica.
type Mes struct {
	// Inicio y Fin son los instantes en que empieza y termina; Fin no es del
	// mes.
	Inicio, Fin time.Time
}

// MesDe es el mes calendario de Costa Rica al que pertenece un instante.
func MesDe(t time.Time) Mes {
	l := t.In(zonaCR)
	inicio := time.Date(l.Year(), l.Month(), 1, 0, 0, 0, 0, zonaCR)
	return Mes{Inicio: inicio.UTC(), Fin: inicio.AddDate(0, 1, 0).UTC()}
}

// PrimerDia es la fecha civil del primer dia del mes: la que se guarda como
// "mes" del caso y del registro.
func (m Mes) PrimerDia() time.Time { return diaCR(m.Inicio) }

// UltimoDia es la fecha civil del ultimo dia del mes: el de la venta con la que
// se convierte el total al cerrarlo.
func (m Mes) UltimoDia() time.Time { return diaCR(m.Fin.Add(-time.Second)) }

// Anterior es el mes calendario anterior.
func (m Mes) Anterior() Mes { return MesDe(m.Inicio.Add(-time.Second)) }

// String es el mes como '2026-10'.
func (m Mes) String() string { return m.Inicio.In(zonaCR).Format("2006-01") }

func fecha(d time.Time) string { return d.Format(time.DateOnly) }
