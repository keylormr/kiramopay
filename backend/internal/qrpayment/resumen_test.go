package qrpayment

import "testing"

// El resumen por periodo agrupa por moneda: colones y dolares nunca se suman.

func TestCombinarMonedas_SinComparacionSoloTraeLoDelPeriodo(t *testing.T) {
	actual := []totalMoneda{{Currency: "CRC", Gross: 100000, Fee: 500, Count: 2}}
	anterior := []totalMoneda{{Currency: "CRC", Gross: 50000, Fee: 250, Count: 1}, {Currency: "USD", Gross: 100, Fee: 1, Count: 1}}

	got := combinarMonedas(actual, anterior, false)

	if len(got) != 1 || got[0].Currency != "CRC" {
		t.Fatalf("monedas = %+v, se esperaba solo CRC", got)
	}
	m := got[0]
	if m.Gross != 100000 || m.Fee != 500 || m.Net != 99500 || m.Count != 2 {
		t.Errorf("totales = %+v", m)
	}
	if m.Previous != nil || m.Delta != nil {
		t.Errorf("sin el plan que lo incluye no hay comparacion: previous=%+v delta=%+v", m.Previous, m.Delta)
	}
}

func TestCombinarMonedas_ConComparacionCalculaLaVariacionPorMoneda(t *testing.T) {
	actual := []totalMoneda{{Currency: "CRC", Gross: 1000, Fee: 5, Count: 2}}
	anterior := []totalMoneda{{Currency: "CRC", Gross: 500, Fee: 3, Count: 1}}

	got := combinarMonedas(actual, anterior, true)

	if len(got) != 1 {
		t.Fatalf("monedas = %+v", got)
	}
	m := got[0]
	if m.Previous == nil || m.Previous.Gross != 500 || m.Previous.Fee != 3 || m.Previous.Net != 497 || m.Previous.Count != 1 {
		t.Fatalf("previous = %+v", m.Previous)
	}
	d := m.Delta
	if d == nil || d.Gross != 500 || d.Fee != 2 || d.Net != 498 || d.Count != 1 {
		t.Fatalf("delta = %+v", d)
	}
	if d.GrossPct == nil || *d.GrossPct != 100 || d.CountPct == nil || *d.CountPct != 100 {
		t.Errorf("porcentajes: bruto=%v cobros=%v", d.GrossPct, d.CountPct)
	}
	if d.NetPct == nil || *d.NetPct != 100.2 {
		t.Errorf("porcentaje del neto = %v, se esperaba 100.2", d.NetPct)
	}
}

// Una moneda que solo tuvo ventas en el periodo anterior sigue apareciendo,
// con el periodo actual en cero REAL (el servidor lo conto): sin ella la
// pantalla no podria decir "bajo contra el periodo anterior".
func TestCombinarMonedas_UnaMonedaSoloDelPeriodoAnteriorApareceEnCero(t *testing.T) {
	anterior := []totalMoneda{{Currency: "USD", Gross: 10000, Fee: 50, Count: 1}}

	got := combinarMonedas(nil, anterior, true)

	if len(got) != 1 || got[0].Currency != "USD" {
		t.Fatalf("monedas = %+v", got)
	}
	m := got[0]
	if m.Gross != 0 || m.Count != 0 || m.Previous == nil || m.Previous.Gross != 10000 {
		t.Fatalf("moneda = %+v", m)
	}
	if m.Delta == nil || m.Delta.Gross != -10000 || m.Delta.GrossPct == nil || *m.Delta.GrossPct != -100 {
		t.Fatalf("delta = %+v", m.Delta)
	}
}

// Contra un periodo anterior sin ventas no hay porcentaje honesto: nil, no
// infinito ni 100.
func TestCombinarMonedas_SinVentasAntesNoHayPorcentaje(t *testing.T) {
	actual := []totalMoneda{{Currency: "CRC", Gross: 1000, Fee: 5, Count: 1}}

	got := combinarMonedas(actual, nil, true)

	if len(got) != 1 || got[0].Previous == nil || got[0].Previous.Count != 0 || got[0].Previous.Gross != 0 {
		t.Fatalf("monedas = %+v", got)
	}
	d := got[0].Delta
	if d == nil || d.Gross != 1000 || d.GrossPct != nil || d.NetPct != nil || d.CountPct != nil {
		t.Fatalf("delta = %+v, los porcentajes contra cero deben ser nil", d)
	}
}

func TestCombinarMonedas_LasMonedasSalenOrdenadas(t *testing.T) {
	actual := []totalMoneda{{Currency: "USD", Gross: 1, Count: 1}, {Currency: "CRC", Gross: 2, Count: 1}}
	got := combinarMonedas(actual, nil, false)
	if len(got) != 2 || got[0].Currency != "CRC" || got[1].Currency != "USD" {
		t.Fatalf("monedas = %+v, se esperaba CRC y luego USD", got)
	}
}
