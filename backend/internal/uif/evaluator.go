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
	// MensualUSD es el umbral de las transacciones multiples: lo que el cliente
	// movio en el MES CALENDARIO, por cualquier medio de pago, igual o por encima
	// dispara el registro (SUGEF 13-19 art. 20, Lin. 22.2). Es el acumulado
	// regulatorio.
	MensualUSD int64
	// Acumulado30USD es el umbral de la alerta interna de estructuracion: las
	// salidas de los ultimos 30 dias moviles. Es el MISMO numero legal; lo que
	// cambia es la ventana. Un mes calendario se puede partir en dos mitades de
	// meses distintos, y esta ventana lo ve.
	Acumulado30USD int64
}

// DefaultThresholds: US$10.000 en las cuatro reglas.
func DefaultThresholds() Thresholds {
	return Thresholds{
		SingleUSD:      1_000_000,
		DailyUSD:       1_000_000,
		MensualUSD:     1_000_000,
		Acumulado30USD: 1_000_000,
	}
}

// conLosDeLey reemplaza por el de la ley todo umbral que no sea positivo. Un
// umbral en cero no es "sin umbral": todo movimiento lo iguala y cada uno
// abriria un caso.
func (t Thresholds) conLosDeLey() Thresholds {
	ley := DefaultThresholds()
	if t.SingleUSD <= 0 {
		t.SingleUSD = ley.SingleUSD
	}
	if t.DailyUSD <= 0 {
		t.DailyUSD = ley.DailyUSD
	}
	if t.MensualUSD <= 0 {
		t.MensualUSD = ley.MensualUSD
	}
	if t.Acumulado30USD <= 0 {
		t.Acumulado30USD = ley.Acumulado30USD
	}
	return t
}

// cruza dice si un total pasa de estar por debajo del umbral a igualarlo o
// superarlo. Solo en el cruce: si disparara con cada movimiento posterior, la
// cola se llenaria de copias del mismo caso y el oficial dejaria de leerla.
func cruza(antes, ahora, umbral int64) bool {
	return antes < umbral && ahora >= umbral
}

// EvaluateAcumulado decide si las salidas de los ultimos 30 dias moviles CRUZAN
// el umbral con este movimiento. Es la alerta interna de estructuracion, no el
// disparo regulatorio (ese es el mes calendario).
//
// Todo en centavos de dolar. prior30USD es el acumulado de 30 dias SIN este
// movimiento.
func (t Thresholds) EvaluateAcumulado(amountUSD, prior30USD int64) Result {
	nuevo := prior30USD + amountUSD
	if cruza(prior30USD, nuevo, t.Acumulado30USD) {
		return Result{
			Reportable: true,
			Type:       TypeEstructuracion30,
			Reason: fmt.Sprintf("alerta interna de estructuracion: las salidas de los ultimos 30 dias moviles "+
				"sumaron US$%s y cruzaron US$%s (no es el acumulado regulatorio, que es el mes calendario)",
				dolares(nuevo), dolares(t.Acumulado30USD)),
		}
	}
	return Result{}
}

// Result is the outcome of evaluating one transaction.
type Result struct {
	Reportable bool
	Type       string // single_threshold | structuring | multiples_mes | estructuracion_30d
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
	if cruza(priorDailyUSD, newTotal, t.DailyUSD) {
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
