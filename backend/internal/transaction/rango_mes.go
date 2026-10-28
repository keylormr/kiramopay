package transaction

import (
	"fmt"
	"time"
)

// RangoDelMes arma el rango del resumen para un mes calendario de Costa Rica:
// el mes en curso con mesesAtras en 0, el anterior con 1.
//
// El mes se decide con el reloj de Costa Rica y no con el del servidor, que
// corre en UTC: a las 8 p. m. del 31 de octubre en Costa Rica ya es noviembre en
// UTC, y un gasto de esa noche cae en el mes equivocado. Es el mismo corte de
// dias del resumen (ZonaResumen) y de la tarjeta "Gastado este mes" del Inicio.
func RangoDelMes(ahora time.Time, mesesAtras int) (RangoResumen, error) {
	if mesesAtras < 0 {
		return RangoResumen{}, fmt.Errorf("%w: mesesAtras no puede ser negativo", ErrRangoResumen)
	}
	enCostaRica := ahora.UTC().Add(time.Duration(desfaseCostaRica) * time.Second)
	primero := time.Date(enCostaRica.Year(), enCostaRica.Month(), 1, 0, 0, 0, 0, time.UTC).AddDate(0, -mesesAtras, 0)
	siguiente := primero.AddDate(0, 1, 0)
	return ParseRangoResumen(primero.Format(time.DateOnly), siguiente.Format(time.DateOnly))
}

// TiposDeIngresoEnPantalla son los tipos de movimiento que la aplicacion cuenta
// como ingreso: la lista, la tarjeta "Gastado este mes" del Inicio y el analisis
// suman como gasto TODO lo que no esta aqui.
//
// Es la copia en el servidor de INCOMING_TYPES, en
// src/api/adapters/http/transaction.http.ts. Hay una prueba que lee el archivo
// del front y compara los dos conjuntos: si uno cambia sin el otro, el asistente
// y la pantalla dejarian de contar el mismo dinero sin que nada falle.
//
// No es TiposDeEntrada. Esa es la lista de la UIF y se escribio con otro
// criterio ("ante la duda, revisar de mas"): deja fuera savings_withdraw y
// loyalty_cashback, que la pantalla cuenta como ingreso, y trae
// merchant_withdrawal, que la pantalla cuenta como salida.
var TiposDeIngresoEnPantalla = []string{
	"sinpe_receive", "qr_receive", "deposit", "p2p_receive", "refund", "crypto_sell",
	"savings_withdraw", "escrow_receive", "escrow_refund", "loyalty_cashback",
}

// EsIngresoEnPantalla dice si la aplicacion cuenta un tipo de movimiento como
// ingreso. Todo lo demas, incluido un tipo que no existe, se cuenta como gasto,
// igual que en el front.
func EsIngresoEnPantalla(tipo string) bool {
	for _, t := range TiposDeIngresoEnPantalla {
		if t == tipo {
			return true
		}
	}
	return false
}
