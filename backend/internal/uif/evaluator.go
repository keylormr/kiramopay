package uif

import "fmt"

// Thresholds holds the per-currency reporting ceilings, in minor units
// (centimos / cents). Ley 8204 keys reporting to ~USD 10,000 or its local
// equivalent; values are configurable so they can track regulation.
type Thresholds struct {
	Single map[string]int64 // per-currency single-transaction ceiling
	Daily  map[string]int64 // per-currency same-day aggregate ceiling (structuring)
	// Acumulado30 es el umbral del acumulado de salidas de los ultimos 30 dias.
	// Es el MISMO numero legal que los otros dos: lo que cambia es la ventana.
	// El tope diario se reinicia cada dia, asi que quien quiere mover mucho sin
	// que se vea lo reparte en dias; esta regla es la que lo ve.
	Acumulado30 map[string]int64
}

// DefaultThresholds: USD 10,000 and an approximate CRC equivalent.
func DefaultThresholds() Thresholds {
	return Thresholds{
		Single: map[string]int64{
			"USD": 1_000_000,   // $10,000.00 in cents
			"CRC": 550_000_000, // ~₡5,500,000 in centimos
		},
		Daily: map[string]int64{
			"USD": 1_000_000,
			"CRC": 550_000_000,
		},
		Acumulado30: map[string]int64{
			"USD": 1_000_000,
			"CRC": 550_000_000,
		},
	}
}

// EvaluateAcumulado decide si el acumulado de 30 dias CRUZA el umbral con este
// movimiento: antes estaba por debajo y ahora no. Solo en el cruce, igual que la
// estructuracion diaria: si disparara con cada movimiento posterior, la cola
// se llenaria de copias del mismo caso y el oficial dejaria de leerla.
//
// prior30Minor es el acumulado de 30 dias SIN este movimiento.
func (t Thresholds) EvaluateAcumulado(currency string, amountMinor, prior30Minor int64) Result {
	umbral, ok := t.Acumulado30[currency]
	if !ok {
		return Result{}
	}
	nuevo := prior30Minor + amountMinor
	if prior30Minor < umbral && nuevo >= umbral {
		return Result{
			Reportable: true,
			Type:       TypeAcumulado30,
			Reason: fmt.Sprintf("salidas de los ultimos 30 dias: %d %s cruzaron el umbral %d "+
				"(repartidas en varios dias, ninguna regla diaria las veia)", nuevo, currency, umbral),
		}
	}
	return Result{}
}

// Result is the outcome of evaluating one transaction.
type Result struct {
	Reportable bool
	Type       string // single_threshold | structuring
	Reason     string
}

// Evaluate decides whether a transaction is UIF-reportable.
//
//   - amountMinor: this transaction's amount (minor units).
//   - priorDailyMinor: the user's same-day total BEFORE this transaction.
//
// single_threshold fires when one transaction meets/exceeds the ceiling.
// structuring fires when the running same-day total CROSSES the ceiling with
// this transaction (i.e. it was below before and is at/above now) — catching
// amounts split to stay under the single-transaction ceiling.
func (t Thresholds) Evaluate(currency string, amountMinor, priorDailyMinor int64) Result {
	if single, ok := t.Single[currency]; ok && amountMinor >= single {
		return Result{
			Reportable: true,
			Type:       TypeSingleThreshold,
			Reason: fmt.Sprintf("single transaction %d %s >= reporting threshold %d",
				amountMinor, currency, single),
		}
	}
	if daily, ok := t.Daily[currency]; ok {
		newTotal := priorDailyMinor + amountMinor
		if priorDailyMinor < daily && newTotal >= daily {
			return Result{
				Reportable: true,
				Type:       TypeStructuring,
				Reason: fmt.Sprintf("same-day aggregate %d %s crossed threshold %d (structuring)",
					newTotal, currency, daily),
			}
		}
	}
	return Result{}
}
