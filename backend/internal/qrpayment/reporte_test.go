package qrpayment

import (
	"bytes"
	"encoding/csv"
	"strings"
	"testing"
	"time"
)

func TestComisionEfectiva(t *testing.T) {
	ahora := time.Date(2026, 9, 13, 12, 0, 0, 0, time.UTC)
	futuro := ahora.Add(time.Hour)
	pasado := ahora.Add(-time.Hour)
	exacto := ahora

	casos := []struct {
		nombre string
		bps    int
		promo  *time.Time
		quiero int
	}{
		{"sin promocion", 50, nil, 50},
		{"promocion vigente", 50, &futuro, PromoEntradaBps},
		{"promocion vencida", 50, &pasado, 50},
		{"vence en este instante: ya no aplica", 50, &exacto, 50},
		{"el administrador fijo una menor: se respeta", 10, &futuro, 10},
		{"el administrador fijo una mayor: gana la promocion", 100, &futuro, PromoEntradaBps},
		{"comision cero", 0, &futuro, 0},
	}
	for _, c := range casos {
		if got := ComisionEfectiva(c.bps, c.promo, ahora); got != c.quiero {
			t.Errorf("%s: ComisionEfectiva(%d) = %d, se esperaba %d", c.nombre, c.bps, got, c.quiero)
		}
	}
}

func TestLaPromocionDeEntradaEsLaDecididaPorElDueno(t *testing.T) {
	if PromoEntradaBps != 25 || PromoEntradaMeses != 3 {
		t.Fatalf("promocion = %d bps por %d meses; la decision es 0,25 %% por 3 meses", PromoEntradaBps, PromoEntradaMeses)
	}
	if DefaultCommissionBps != 50 {
		t.Fatalf("comision estandar = %d bps; la decision es 0,5 %%", DefaultCommissionBps)
	}
}

func TestCalcularVentana(t *testing.T) {
	// 13-09-2026 15:00 UTC son las 09:00 en Costa Rica (UTC-6; getTimezoneOffset = 360).
	ahora := time.Date(2026, 9, 13, 15, 0, 0, 0, time.UTC)
	v := calcularVentana(ahora, 7, 360)

	if v.dias != 7 {
		t.Fatalf("dias = %d, se esperaba 7", v.dias)
	}
	if got := v.desde.UTC(); !got.Equal(time.Date(2026, 9, 7, 6, 0, 0, 0, time.UTC)) {
		t.Errorf("desde = %v, se esperaba la medianoche del 7 en Costa Rica", got)
	}
	if !v.hasta.Equal(ahora) {
		t.Errorf("hasta = %v, se esperaba ahora", v.hasta)
	}
	if got := v.anteriorDesde.UTC(); !got.Equal(time.Date(2026, 8, 31, 6, 0, 0, 0, time.UTC)) {
		t.Errorf("anteriorDesde = %v, se esperaba la medianoche del 31 de agosto en Costa Rica", got)
	}
	if got := v.anteriorHasta.UTC(); !got.Equal(time.Date(2026, 9, 6, 15, 0, 0, 0, time.UTC)) {
		t.Errorf("anteriorHasta = %v, se esperaba el 6 a la misma hora", got)
	}
	if v.hasta.Sub(v.desde) != v.anteriorHasta.Sub(v.anteriorDesde) {
		t.Error("las dos ventanas no miden lo mismo")
	}
	if !v.anteriorHasta.Before(v.desde) {
		t.Error("la ventana anterior se superpone con la actual")
	}
	fechas := []struct{ nombre, got, quiero string }{
		{"desde", v.desde.Format(formatoDia), "2026-09-07"},
		{"hasta", v.hasta.Format(formatoDia), "2026-09-13"},
		{"anteriorDesde", v.anteriorDesde.Format(formatoDia), "2026-08-31"},
		{"anteriorHasta", v.anteriorHasta.Format(formatoDia), "2026-09-06"},
	}
	for _, f := range fechas {
		if f.got != f.quiero {
			t.Errorf("%s = %s, se esperaba %s", f.nombre, f.got, f.quiero)
		}
	}

	// Fuera de rango vuelve a lo de siempre: 30 dias, en UTC.
	v = calcularVentana(ahora, 0, 9999)
	if v.dias != 30 || !v.desde.Equal(time.Date(2026, 8, 15, 0, 0, 0, 0, time.UTC)) {
		t.Errorf("fuera de rango: dias=%d desde=%v", v.dias, v.desde)
	}
	if v = calcularVentana(ahora, 400, 0); v.dias != 30 {
		t.Errorf("400 dias: dias=%d, se esperaba 30", v.dias)
	}
}

func TestVariacionPct(t *testing.T) {
	if got := variacionPct(500, 0); got != nil {
		t.Fatalf("contra cero = %v, se esperaba nil", *got)
	}
	casos := []struct {
		actual, anterior int64
		quiero           float64
	}{
		{150, 100, 50},
		{0, 100, -100},
		{100, 100, 0},
		{1, 3, -66.67},
		{10000, 9975, 0.25},
	}
	for _, c := range casos {
		got := variacionPct(c.actual, c.anterior)
		if got == nil || *got != c.quiero {
			t.Errorf("variacionPct(%d, %d) = %v, se esperaba %v", c.actual, c.anterior, got, c.quiero)
		}
	}
}

func TestCeldaSegura(t *testing.T) {
	for _, peligrosa := range []string{"=1+1", "+1+1", "-1+1", "@SUM(A1)", "\t=1", "\r=1",
		`=HYPERLINK("http://malo","clic")`, "=cmd|' /C calc'!A0"} {
		if got := celdaSegura(peligrosa); got != "'"+peligrosa {
			t.Errorf("celdaSegura(%q) = %q, se esperaba el apostrofo delante", peligrosa, got)
		}
	}
	for _, segura := range []string{"", "Sucursal Centro", "2026-09-13", "1234.50", "(sin asignar)", "Perez, \"el Tico\""} {
		if got := celdaSegura(segura); got != segura {
			t.Errorf("celdaSegura(%q) = %q, no debia cambiar", segura, got)
		}
	}
}

func TestMonto(t *testing.T) {
	casos := map[int64]string{0: "0.00", 5: "0.05", 50: "0.50", 123456: "1234.56", -150: "-1.50"}
	for centimos, quiero := range casos {
		if got := monto(centimos); got != quiero {
			t.Errorf("monto(%d) = %q, se esperaba %q", centimos, got, quiero)
		}
	}
}

func reporteDePrueba() *MerchantReport {
	b := func(key, label string, gross, fee int64) ReportBucket {
		return ReportBucket{Key: key, Label: label, Gross: gross, Fee: fee, Net: gross - fee, Count: 1}
	}
	return &MerchantReport{
		Days: 7, From: "2026-09-07", To: "2026-09-13",
		Totals: ReportBucket{Gross: 30000, Fee: 75, Net: 29925, Count: 2},
		Daily: []ReportDay{
			{Date: "2026-09-12", Gross: 20000, Fee: 50, Net: 19950, Count: 1},
			{Date: "2026-09-13", Gross: 10000, Fee: 25, Net: 9975, Count: 1},
		},
		ByLocation: []ReportBucket{
			b("loc-1", `=HYPERLINK("http://malo","clic")`, 20000, 50),
			b("", "", 10000, 25),
		},
		ByCollector: []ReportBucket{
			b("u-1", "@SUM(1+1)", 5000, 10),
			b("u-2", "+50688881234", 5000, 10),
			b("u-3", "-2+3", 5000, 10),
			b("u-4", "\tTabulador", 5000, 10),
			b("u-5", "\rRetorno", 5000, 10),
			b("u-6", "Perez, \"el Tico\"", 5000, 25),
		},
		Plan: PlanComercioAnalitica,
		Comparison: &ReportComparison{
			PreviousFrom: "2026-08-31", PreviousTo: "2026-09-06",
			PreviousTotals: ReportBucket{Gross: 10000, Fee: 25, Net: 9975, Count: 1},
		},
	}
}

func TestEscribirReporteCSV_NeutralizaFormulasYArmaLasSecciones(t *testing.T) {
	var buf bytes.Buffer
	if err := EscribirReporteCSV(&buf, reporteDePrueba()); err != nil {
		t.Fatalf("EscribirReporteCSV: %v", err)
	}
	crudo := buf.String()
	if !strings.HasPrefix(crudo, bomUTF8) {
		t.Fatal("falta la marca de orden de bytes: la hoja de calculo rompe las tildes")
	}
	// El retorno de carro sobrevive dentro de un campo entre comillas; se mira
	// en crudo porque el lector de CSV puede normalizarlo.
	if !strings.Contains(crudo, "'\rRetorno") {
		t.Error("el nombre que empieza con retorno de carro no se neutralizo")
	}

	filas, err := csv.NewReader(strings.NewReader(strings.TrimPrefix(crudo, bomUTF8))).ReadAll()
	if err != nil {
		t.Fatalf("el archivo no es un CSV valido: %v", err)
	}
	cabecera := strings.Join(filas[0], ",")
	if cabecera != "seccion,desde,hasta,clave,nombre,bruto,comision,neto,cobros" {
		t.Fatalf("cabecera = %s", cabecera)
	}
	// cabecera + 2 dias + 2 sucursales + 6 cobradores + total + periodo anterior
	if len(filas) != 13 {
		t.Fatalf("filas = %d, se esperaban 13", len(filas))
	}
	for i, fila := range filas[1:] {
		for j, celda := range fila {
			if celda != "" && strings.ContainsRune("=+-@\t\r", rune(celda[0])) {
				t.Errorf("fila %d, columna %d empieza como formula: %q", i+1, j, celda)
			}
		}
	}

	buscar := func(seccion, clave string) []string {
		for _, f := range filas[1:] {
			if f[0] == seccion && f[3] == clave {
				return f
			}
		}
		t.Fatalf("no hay fila %s/%q", seccion, clave)
		return nil
	}
	if f := buscar("sucursal", "loc-1"); f[4] != `'=HYPERLINK("http://malo","clic")` ||
		f[5] != "200.00" || f[6] != "0.50" || f[7] != "199.50" || f[8] != "1" {
		t.Errorf("sucursal con formula: %q", f)
	}
	if f := buscar("sucursal", ""); f[4] != "(sin asignar)" {
		t.Errorf("sucursal sin asignar: %q", f)
	}
	if f := buscar("cobrador", "u-2"); f[4] != "'+50688881234" {
		t.Errorf("cobrador con +: %q", f)
	}
	if f := buscar("cobrador", "u-6"); f[4] != "Perez, \"el Tico\"" {
		t.Errorf("las comillas y la coma no sobrevivieron: %q", f)
	}
	if f := buscar("total", ""); f[1] != "2026-09-07" || f[2] != "2026-09-13" || f[5] != "300.00" || f[8] != "2" {
		t.Errorf("total: %q", f)
	}
	if f := buscar("periodo_anterior", ""); f[1] != "2026-08-31" || f[2] != "2026-09-06" || f[5] != "100.00" {
		t.Errorf("periodo anterior: %q", f)
	}
	if f := filas[1]; f[0] != "dia" || f[1] != "2026-09-12" || f[2] != "2026-09-12" || f[5] != "200.00" {
		t.Errorf("primer dia: %q", f)
	}
}

func TestEscribirReporteCSV_SinComparacionNoHayPeriodoAnterior(t *testing.T) {
	rep := reporteDePrueba()
	rep.Comparison = nil
	var buf bytes.Buffer
	if err := EscribirReporteCSV(&buf, rep); err != nil {
		t.Fatalf("EscribirReporteCSV: %v", err)
	}
	if strings.Contains(buf.String(), "periodo_anterior") {
		t.Fatal("sin comparacion se escribio una fila del periodo anterior")
	}
}
