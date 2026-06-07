package uif

import "fmt"

// Thresholds holds the per-currency reporting ceilings, in minor units
// (centimos / cents). Ley 8204 keys reporting to ~USD 10,000 or its local
// equivalent; values are configurable so they can track regulation.
type Thresholds struct {
	Single map[string]int64 // per-currency single-transaction ceiling
	Daily  map[string]int64 // per-currency same-day aggregate ceiling (structuring)
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
	}
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
