package uif

import (
	"fmt"
	"math"
)

// Thresholds son los umbrales de reporte, en centavos de dolar. La ley (Ley
// 7786, reformada por la 8204) fija US$10.000 o su equivalente en otras
// monedas: el umbral es uno solo y en dolares, y cada movimiento se compara
// por su equivalente con el tipo de cambio oficial (ver Service.Report).
//
// Antes cada moneda tenia su propio numero fijo. El de colones (₡5.500.000) no
// seguia el tipo de cambio —con el colon a 455,6 equivalia a unos US$12.070—,
// una moneda sin numero propio no se evaluaba nunca, y el agregado del dia
// sumaba cada moneda por separado.
type Thresholds struct {
	SingleUSD int64 // un solo movimiento
	DailyUSD  int64 // lo que sale en el dia, todas las monedas juntas (estructuracion)
	// Acumulado30USD es el umbral del acumulado de salidas de los ultimos 30
	// dias. Es el MISMO numero legal que los otros dos: lo que cambia es la
	// ventana. El tope diario se reinicia cada dia, asi que quien quiere mover
	// mucho sin que se vea lo reparte en dias; esta regla es la que lo ve.
	Acumulado30USD int64
}

// DefaultThresholds: US$10.000 en las tres reglas.
func DefaultThresholds() Thresholds {
	return Thresholds{
		SingleUSD:      1_000_000,
		DailyUSD:       1_000_000,
		Acumulado30USD: 1_000_000,
	}
}

// EvaluateAcumulado decide si el acumulado de 30 dias CRUZA el umbral con este
// movimiento: antes estaba por debajo y ahora no. Solo en el cruce, igual que la
// estructuracion diaria: si disparara con cada movimiento posterior, la cola
// se llenaria de copias del mismo caso y el oficial dejaria de leerla.
//
// Todo en centavos de dolar. prior30USD es el acumulado de 30 dias SIN este
// movimiento.
func (t Thresholds) EvaluateAcumulado(amountUSD, prior30USD int64) Result {
	nuevo := prior30USD + amountUSD
	if prior30USD < t.Acumulado30USD && nuevo >= t.Acumulado30USD {
		return Result{
			Reportable: true,
			Type:       TypeAcumulado30,
			Reason: fmt.Sprintf("salidas de los ultimos 30 dias: US$%s cruzaron el umbral de US$%s "+
				"(repartidas en varios dias, ninguna regla diaria las veia)", dolares(nuevo), dolares(t.Acumulado30USD)),
		}
	}
	return Result{}
}

// Result is the outcome of evaluating one transaction.
type Result struct {
	Reportable bool
	Type       string // single_threshold | structuring | acumulado_30d
	Reason     string
}

// Evaluate decides whether a transaction is UIF-reportable. Todo en centavos de
// dolar.
//
//   - amountUSD: el equivalente de este movimiento.
//   - priorDailyUSD: lo que salio en el dia ANTES de este movimiento, todas las
//     monedas juntas.
//
// single_threshold fires when one transaction meets/exceeds the ceiling.
// structuring fires when the running same-day total CROSSES the ceiling with
// this transaction (i.e. it was below before and is at/above now) — catching
// amounts split to stay under the single-transaction ceiling.
func (t Thresholds) Evaluate(amountUSD, priorDailyUSD int64) Result {
	if amountUSD >= t.SingleUSD {
		return Result{
			Reportable: true,
			Type:       TypeSingleThreshold,
			Reason: fmt.Sprintf("un solo movimiento de US$%s iguala o supera el umbral de US$%s",
				dolares(amountUSD), dolares(t.SingleUSD)),
		}
	}
	newTotal := priorDailyUSD + amountUSD
	if priorDailyUSD < t.DailyUSD && newTotal >= t.DailyUSD {
		return Result{
			Reportable: true,
			Type:       TypeStructuring,
			Reason: fmt.Sprintf("las salidas del dia sumaron US$%s y cruzaron el umbral de US$%s "+
				"(estructuracion: repartidas para no superarlo de una vez)", dolares(newTotal), dolares(t.DailyUSD)),
		}
	}
	return Result{}
}

// enCentavosDeDolar convierte un monto en la unidad menor de una moneda a
// centavos de dolar. Las dos son centesimas, asi que basta dividir por el tipo
// de cambio (unidades de la moneda por dolar). Se redondea al centavo.
func enCentavosDeDolar(minor int64, porDolar float64) int64 {
	return int64(math.Round(float64(minor) / porDolar))
}

// dolares escribe centavos como "10974.54", sin separador de miles: el texto
// queda en la razon del caso, que lee el oficial de cumplimiento.
func dolares(centavos int64) string {
	signo := ""
	if centavos < 0 {
		signo, centavos = "-", -centavos
	}
	return fmt.Sprintf("%s%d.%02d", signo, centavos/100, centavos%100)
}
