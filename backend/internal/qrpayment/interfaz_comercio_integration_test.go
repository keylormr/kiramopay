package qrpayment_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kiramopay/backend/internal/qrpayment"
)

// La interfaz del comercio: quien pago y a que sucursal, los movimientos por
// periodo, los totales de cada dia, el resumen con su comparacion y los
// retiros. Todo se cuenta en el dia de calendario de quien mira (tz).

// El "ahora" de todas las pruebas: 29-10-2026 09:30 en Costa Rica.
var ahoraDeLaInterfaz = time.Date(2026, 10, 29, 15, 30, 0, 0, time.UTC)

type ventasDeLaInterfaz struct {
	svc      *qrpayment.Service
	pool     *pgxpool.Pool
	payer    string
	owner    string
	employee string
	merchant *qrpayment.Merchant

	hoy, ayerNoche, delMes, delMesPasado, enDolares, devuelta *qrpayment.QRPaymentRecord
}

func moverVenta(t *testing.T, pool *pgxpool.Pool, id, cuando string) {
	t.Helper()
	if _, err := pool.Exec(context.Background(),
		`UPDATE qr_payments SET created_at = $2::timestamptz, completed_at = $2::timestamptz WHERE id = $1::uuid`, id, cuando); err != nil {
		t.Fatalf("mover venta %s: %v", id, err)
	}
}

// armarVentas deja un comercio con ventas repartidas en varios periodos:
//
//	hoy           100.000  29-10 01:00 CR   (07:00 UTC)
//	ayerNoche      40.000  28-10 21:00 CR   (03:00 UTC del 29: en UTC ya es "hoy")
//	enDolares     100 USD  28-10 14:00 CR   (en dolares)
//	delMes         20.000  05-10
//	delMesPasado   60.000  15-09
//	devuelta        5.000  29-10 02:00 CR   (estado refunded: no es una venta)
func armarVentas(t *testing.T) *ventasDeLaInterfaz {
	t.Helper()
	svc, pool, payer, owner := setupQR(t)
	ctx := context.Background()
	m := comercioVerificado(t, svc, owner)
	terminarPromocion(t, pool, m.ID)
	employee := seedEmployee(t, pool, "505550555")
	if _, err := svc.AddStaff(ctx, m.ID, owner, &qrpayment.AddStaffRequest{Cedula: "505550555", Role: "cashier"}); err != nil {
		t.Fatalf("agregar cajero: %v", err)
	}
	v := &ventasDeLaInterfaz{svc: svc, pool: pool, payer: payer, owner: owner, employee: employee, merchant: m}

	v.hoy = pagarAlComercio(t, svc, payer, owner, m.ID, 100000)
	v.ayerNoche = pagarAlComercio(t, svc, payer, owner, m.ID, 40000)
	v.enDolares = pagarAlComercio(t, svc, payer, owner, m.ID, 10000)
	v.delMes = pagarAlComercio(t, svc, payer, owner, m.ID, 20000)
	v.delMesPasado = pagarAlComercio(t, svc, payer, owner, m.ID, 60000)
	v.devuelta = pagarAlComercio(t, svc, payer, owner, m.ID, 5000)

	moverVenta(t, pool, v.hoy.ID, "2026-10-29T07:00:00Z")
	moverVenta(t, pool, v.ayerNoche.ID, "2026-10-29T03:00:00Z")
	moverVenta(t, pool, v.enDolares.ID, "2026-10-28T20:00:00Z")
	moverVenta(t, pool, v.delMes.ID, "2026-10-05T12:00:00Z")
	moverVenta(t, pool, v.delMesPasado.ID, "2026-09-15T12:00:00Z")
	moverVenta(t, pool, v.devuelta.ID, "2026-10-29T08:00:00Z")
	if _, err := pool.Exec(ctx, `UPDATE qr_payments SET currency = 'USD' WHERE id = $1::uuid`, v.enDolares.ID); err != nil {
		t.Fatalf("pasar a dolares: %v", err)
	}
	if _, err := pool.Exec(ctx, `UPDATE qr_payments SET status = 'refunded' WHERE id = $1::uuid`, v.devuelta.ID); err != nil {
		t.Fatalf("devolver: %v", err)
	}
	return v
}

func idsDe(ventas []qrpayment.QRPaymentRecord) []string {
	ids := make([]string, len(ventas))
	for i, p := range ventas {
		ids[i] = p.ID
	}
	return ids
}

func mismosIds(t *testing.T, nombre string, got []qrpayment.QRPaymentRecord, quiero ...*qrpayment.QRPaymentRecord) {
	t.Helper()
	esperados := make([]string, len(quiero))
	for i, p := range quiero {
		esperados[i] = p.ID
	}
	obtenidos := idsDe(got)
	if len(obtenidos) != len(esperados) {
		t.Fatalf("%s: ventas = %v, se esperaban %v", nombre, obtenidos, esperados)
	}
	for i := range esperados {
		if obtenidos[i] != esperados[i] {
			t.Fatalf("%s: ventas = %v, se esperaban %v (la mas reciente primero)", nombre, obtenidos, esperados)
		}
	}
}

func nombreDe(t *testing.T, pool *pgxpool.Pool, userID string) string {
	t.Helper()
	var n string
	if err := pool.QueryRow(context.Background(),
		`SELECT TRIM(first_name || ' ' || last_name) FROM users WHERE id = $1::uuid`, userID).Scan(&n); err != nil {
		t.Fatalf("leer nombre: %v", err)
	}
	return n
}

// ── Quien pago, a que sucursal y quien cobro ────────────────────────────────

func TestVentas_TraenQuienPagoLaSucursalYElCajero(t *testing.T) {
	svc, pool, payer, owner := setupQR(t)
	ctx := context.Background()
	m := comercioVerificado(t, svc, owner)
	employee := seedEmployee(t, pool, "606660666")
	if _, err := svc.AddStaff(ctx, m.ID, owner, &qrpayment.AddStaffRequest{Cedula: "606660666", Role: "cashier"}); err != nil {
		t.Fatalf("agregar cajero: %v", err)
	}
	loc, err := svc.CreateLocation(ctx, m.ID, owner, &qrpayment.LocationRequest{Name: "Sucursal Centro", Address: "Frente al parque"})
	if err != nil {
		t.Fatalf("crear sucursal: %v", err)
	}

	// Una venta de la caja de la sucursal, cobrada por el cajero.
	codigo, err := svc.CreateQRCode(ctx, employee, &qrpayment.CreateQRCodeRequest{
		Type: "merchant_fixed", Amount: 20000, Currency: "CRC", MerchantID: m.ID, LocationID: loc.ID,
	})
	if err != nil {
		t.Fatalf("cobro del cajero: %v", err)
	}
	conSucursal, err := svc.ScanAndPay(ctx, payer, &qrpayment.ScanQRPaymentRequest{QRData: codigo.QRData, Currency: "CRC"})
	if err != nil {
		t.Fatalf("pago: %v", err)
	}
	// Otra del dueno, sin sucursal.
	sinSucursal := pagarAlComercio(t, svc, payer, owner, m.ID, 10000)

	ventas, err := svc.VentasDelComercio(ctx, m.ID, employee, 50, "")
	if err != nil {
		t.Fatalf("ventas: %v", err)
	}
	porId := map[string]qrpayment.QRPaymentRecord{}
	for _, v := range ventas {
		porId[v.ID] = v
	}

	a := porId[conSucursal.ID]
	if a.PayerName != nombreDe(t, pool, payer) || a.PayerName == "" {
		t.Errorf("pagador = %q, se esperaba %q", a.PayerName, nombreDe(t, pool, payer))
	}
	if a.LocationID != loc.ID || a.LocationName != "Sucursal Centro" {
		t.Errorf("sucursal = %q (%q), se esperaba Sucursal Centro", a.LocationName, a.LocationID)
	}
	if a.CollectorName != nombreDe(t, pool, employee) || a.CollectorName == "" {
		t.Errorf("cajero = %q, se esperaba %q", a.CollectorName, nombreDe(t, pool, employee))
	}

	b := porId[sinSucursal.ID]
	if b.LocationID != "" || b.LocationName != "" {
		t.Errorf("una venta sin sucursal no inventa una: id=%q nombre=%q", b.LocationID, b.LocationName)
	}
	if b.CollectorName != nombreDe(t, pool, owner) {
		t.Errorf("cajero de la venta del dueno = %q, se esperaba %q", b.CollectorName, nombreDe(t, pool, owner))
	}
}

// Una venta anterior al equipo no tiene a quien atribuirse: el cajero sale
// vacio y la pantalla lo dice, no pone un nombre ni un cero.
func TestVentas_UnaVentaSinCajeroNoInventaUnNombre(t *testing.T) {
	svc, pool, payer, owner := setupQR(t)
	ctx := context.Background()
	m := comercioVerificado(t, svc, owner)
	venta := pagarAlComercio(t, svc, payer, owner, m.ID, 10000)
	if _, err := pool.Exec(ctx, `UPDATE qr_payments SET collected_by = NULL WHERE id = $1::uuid`, venta.ID); err != nil {
		t.Fatalf("quitar cajero: %v", err)
	}

	ventas, err := svc.VentasDelComercio(ctx, m.ID, owner, 50, "")
	if err != nil || len(ventas) != 1 {
		t.Fatalf("ventas = %+v (err %v)", ventas, err)
	}
	if ventas[0].CollectorName != "" || ventas[0].CollectedBy != "" {
		t.Errorf("cajero = %q (%q), se esperaba vacio", ventas[0].CollectorName, ventas[0].CollectedBy)
	}
}

// ── Movimientos por periodo ─────────────────────────────────────────────────

func TestVentasPorPeriodo_RespetanElDiaDeQuienMira(t *testing.T) {
	v := armarVentas(t)
	ctx := context.Background()

	pedir := func(p qrpayment.Periodo, tz int) []qrpayment.QRPaymentRecord {
		t.Helper()
		got, err := v.svc.VentasDelComercioEnPeriodo(ctx, v.merchant.ID, v.owner, p, tz, 50, "", ahoraDeLaInterfaz)
		if err != nil {
			t.Fatalf("ventas de %s: %v", p, err)
		}
		return got
	}

	// En Costa Rica la venta de las 21:00 del 28 es de ayer, aunque en UTC sea
	// de hoy. La devuelta se ve: es un movimiento, aunque no sea una venta.
	mismosIds(t, "hoy (CR)", pedir(qrpayment.PeriodoHoy, 360), v.devuelta, v.hoy)
	mismosIds(t, "7 dias (CR)", pedir(qrpayment.PeriodoSemana, 360), v.devuelta, v.hoy, v.ayerNoche, v.enDolares)
	mismosIds(t, "este mes (CR)", pedir(qrpayment.PeriodoMes, 360), v.devuelta, v.hoy, v.ayerNoche, v.enDolares, v.delMes)
	mismosIds(t, "mes anterior (CR)", pedir(qrpayment.PeriodoMesAnterior, 360), v.delMesPasado)

	// El mismo "hoy" en UTC trae la venta de las 03:00Z: la zona manda.
	mismosIds(t, "hoy (UTC)", pedir(qrpayment.PeriodoHoy, 0), v.devuelta, v.hoy, v.ayerNoche)
}

func TestVentasPorPeriodo_SePaginanDentroDelPeriodo(t *testing.T) {
	v := armarVentas(t)
	ctx := context.Background()

	primera, err := v.svc.VentasDelComercioEnPeriodo(ctx, v.merchant.ID, v.owner, qrpayment.PeriodoMes, 360, 2, "", ahoraDeLaInterfaz)
	if err != nil {
		t.Fatalf("primera pagina: %v", err)
	}
	mismosIds(t, "primera pagina", primera, v.devuelta, v.hoy)

	segunda, err := v.svc.VentasDelComercioEnPeriodo(ctx, v.merchant.ID, v.owner, qrpayment.PeriodoMes, 360, 2, primera[1].ID, ahoraDeLaInterfaz)
	if err != nil {
		t.Fatalf("segunda pagina: %v", err)
	}
	mismosIds(t, "segunda pagina", segunda, v.ayerNoche, v.enDolares)

	tercera, err := v.svc.VentasDelComercioEnPeriodo(ctx, v.merchant.ID, v.owner, qrpayment.PeriodoMes, 360, 2, segunda[1].ID, ahoraDeLaInterfaz)
	if err != nil {
		t.Fatalf("tercera pagina: %v", err)
	}
	mismosIds(t, "tercera pagina: la ultima, mas corta que el limite", tercera, v.delMes)
}

func TestVentasPorPeriodo_ElQueNoEsDelEquipoNoLasLee(t *testing.T) {
	v := armarVentas(t)
	if _, err := v.svc.VentasDelComercioEnPeriodo(context.Background(), v.merchant.ID, v.payer, qrpayment.PeriodoHoy, 360, 50, "", ahoraDeLaInterfaz); err == nil {
		t.Fatal("quien no es del equipo no puede leer las ventas del comercio")
	}
}

func TestHandlerVentas_UnPeriodoQueNoExisteEs400(t *testing.T) {
	v := armarVentas(t)
	h := qrpayment.NewHandler(v.svc)

	for _, periodo := range []string{"year", "TODAY", "7d"} {
		rec := httptest.NewRecorder()
		h.GetMerchantPayments(rec, peticion(http.MethodGet,
			"/api/v1/qr/merchants/"+v.merchant.ID+"/payments?period="+periodo+"&tz=360", "", v.owner, v.merchant.ID))
		if rec.Code != http.StatusBadRequest || codigoDeError(t, rec) != "INVALID_PERIOD" {
			t.Errorf("period=%s: %d %s, se esperaba 400 INVALID_PERIOD", periodo, rec.Code, rec.Body.String())
		}
	}

	// Sin periodo sigue siendo el listado de siempre.
	rec := httptest.NewRecorder()
	h.GetMerchantPayments(rec, peticion(http.MethodGet,
		"/api/v1/qr/merchants/"+v.merchant.ID+"/payments", "", v.owner, v.merchant.ID))
	if rec.Code != http.StatusOK {
		t.Fatalf("sin periodo: %d %s", rec.Code, rec.Body.String())
	}
}

func TestHandlerVentas_ConPeriodoDevuelveLasDeEsePeriodo(t *testing.T) {
	v := armarVentas(t)
	h := qrpayment.NewHandler(v.svc)

	rec := httptest.NewRecorder()
	h.GetMerchantPayments(rec, peticion(http.MethodGet,
		"/api/v1/qr/merchants/"+v.merchant.ID+"/payments?period=prev_month&tz=360", "", v.owner, v.merchant.ID))
	if rec.Code != http.StatusOK {
		t.Fatalf("= %d %s", rec.Code, rec.Body.String())
	}
	var sobre struct {
		Data []qrpayment.QRPaymentRecord `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &sobre); err != nil {
		t.Fatalf("respuesta ilegible: %v", err)
	}
	// El "mes anterior" se mide contra el reloj del servidor; la venta de
	// septiembre de 2026 solo cae ahi si hoy es octubre de 2026, asi que aqui se
	// comprueba la forma, no el contenido: el contenido lo prueba la de arriba
	// con un "ahora" fijo.
	for _, venta := range sobre.Data {
		if venta.MerchantID != v.merchant.ID {
			t.Errorf("venta de otro comercio: %+v", venta)
		}
	}
}

// ── Totales de cada dia ─────────────────────────────────────────────────────

func TestTotalesPorDia_AgrupanPorDiaYMonedaYSoloContabilizanLoCompletado(t *testing.T) {
	v := armarVentas(t)

	dias, err := v.svc.TotalesPorDia(context.Background(), v.merchant.ID, v.owner, qrpayment.PeriodoMes, 360, ahoraDeLaInterfaz)
	if err != nil {
		t.Fatalf("totales por dia: %v", err)
	}

	type fila struct {
		fecha, moneda          string
		bruto, comision, neto  int64
		cobros                 int
	}
	quiero := []fila{
		{"2026-10-29", "CRC", 100000, 500, 99500, 1}, // la devuelta (5.000) no cuenta
		{"2026-10-28", "CRC", 40000, 200, 39800, 1},  // 21:00 del 28 en CR
		{"2026-10-28", "USD", 10000, 50, 9950, 1},    // la otra moneda, en su fila
		{"2026-10-05", "CRC", 20000, 100, 19900, 1},
	}
	if len(dias) != len(quiero) {
		t.Fatalf("filas = %+v, se esperaban %d", dias, len(quiero))
	}
	for i, q := range quiero {
		d := dias[i]
		if d.Date != q.fecha || d.Currency != q.moneda || d.Gross != q.bruto || d.Fee != q.comision || d.Net != q.neto || d.Count != q.cobros {
			t.Errorf("fila %d = %+v, se esperaba %+v (el dia mas reciente primero, y por moneda)", i, d, q)
		}
	}
}

func TestTotalesPorDia_LaZonaMueveLaVentaDeDia(t *testing.T) {
	v := armarVentas(t)

	dias, err := v.svc.TotalesPorDia(context.Background(), v.merchant.ID, v.owner, qrpayment.PeriodoHoy, 0, ahoraDeLaInterfaz)
	if err != nil {
		t.Fatalf("totales por dia: %v", err)
	}
	// En UTC, "hoy" empieza a las 00:00Z: entran la venta de las 03:00Z y la de
	// las 07:00Z, las dos del 29.
	if len(dias) != 1 || dias[0].Date != "2026-10-29" || dias[0].Currency != "CRC" || dias[0].Gross != 140000 || dias[0].Count != 2 {
		t.Fatalf("filas = %+v", dias)
	}
}

func TestHandlerTotalesPorDia_ExigeUnPeriodoValido(t *testing.T) {
	v := armarVentas(t)
	h := qrpayment.NewHandler(v.svc)
	for _, url := range []string{"/payments/daily", "/payments/daily?period=year"} {
		rec := httptest.NewRecorder()
		h.GetMerchantDailyTotals(rec, peticion(http.MethodGet, "/api/v1/qr/merchants/"+v.merchant.ID+url, "", v.owner, v.merchant.ID))
		if rec.Code != http.StatusBadRequest || codigoDeError(t, rec) != "INVALID_PERIOD" {
			t.Errorf("%s: %d %s, se esperaba 400 INVALID_PERIOD", url, rec.Code, rec.Body.String())
		}
	}
}

// ── Resumen por periodo ─────────────────────────────────────────────────────

func periodoDe(t *testing.T, r *qrpayment.ResumenDelComercio, p qrpayment.Periodo) qrpayment.ResumenDelPeriodo {
	t.Helper()
	for _, x := range r.Periods {
		if x.Period == p {
			return x
		}
	}
	t.Fatalf("el resumen no trae el periodo %s: %+v", p, r.Periods)
	return qrpayment.ResumenDelPeriodo{}
}

func monedaDe(t *testing.T, p qrpayment.ResumenDelPeriodo, moneda string) qrpayment.ResumenMoneda {
	t.Helper()
	for _, m := range p.Currencies {
		if m.Currency == moneda {
			return m
		}
	}
	t.Fatalf("el periodo %s no trae %s: %+v", p.Period, moneda, p.Currencies)
	return qrpayment.ResumenMoneda{}
}

func TestResumen_PlanBase_TotalesPorPeriodoYMonedaSinComparacion(t *testing.T) {
	v := armarVentas(t)

	r, err := v.svc.ResumenDelComercio(context.Background(), v.merchant.ID, v.owner, 360, ahoraDeLaInterfaz)
	if err != nil {
		t.Fatalf("resumen: %v", err)
	}
	if r.Plan != qrpayment.PlanComercioBase || len(r.Periods) != 4 {
		t.Fatalf("plan=%q periodos=%d", r.Plan, len(r.Periods))
	}

	hoy := periodoDe(t, r, qrpayment.PeriodoHoy)
	if hoy.From != "2026-10-29" || hoy.To != "2026-10-29" {
		t.Errorf("hoy = %s a %s", hoy.From, hoy.To)
	}
	// La devuelta no es una venta: hoy son 100.000 en un cobro, no 105.000 en dos.
	crc := monedaDe(t, hoy, "CRC")
	if crc.Gross != 100000 || crc.Fee != 500 || crc.Net != 99500 || crc.Count != 1 {
		t.Errorf("hoy CRC = %+v", crc)
	}
	if len(hoy.Currencies) != 1 {
		t.Errorf("hoy trae monedas de mas: %+v", hoy.Currencies)
	}

	semana := periodoDe(t, r, qrpayment.PeriodoSemana)
	if c := monedaDe(t, semana, "CRC"); c.Gross != 140000 || c.Count != 2 {
		t.Errorf("7 dias CRC = %+v (colones: hoy y 21:00 de ayer)", c)
	}
	// Los dolares no se suman con los colones: van en su propia moneda.
	if u := monedaDe(t, semana, "USD"); u.Gross != 10000 || u.Fee != 50 || u.Count != 1 {
		t.Errorf("7 dias USD = %+v", u)
	}

	mes := periodoDe(t, r, qrpayment.PeriodoMes)
	if c := monedaDe(t, mes, "CRC"); c.Gross != 160000 || c.Count != 3 {
		t.Errorf("este mes CRC = %+v", c)
	}

	anterior := periodoDe(t, r, qrpayment.PeriodoMesAnterior)
	if anterior.From != "2026-09-01" || anterior.To != "2026-09-30" {
		t.Errorf("mes anterior = %s a %s", anterior.From, anterior.To)
	}
	if c := monedaDe(t, anterior, "CRC"); c.Gross != 60000 || c.Count != 1 {
		t.Errorf("mes anterior CRC = %+v", c)
	}

	// Sin el plan Analitica no hay comparacion, ni el periodo anterior.
	for _, p := range r.Periods {
		if p.PreviousFrom != "" || p.PreviousTo != "" {
			t.Errorf("%s trae fechas del periodo anterior sin el plan: %+v", p.Period, p)
		}
		for _, m := range p.Currencies {
			if m.Previous != nil || m.Delta != nil {
				t.Errorf("%s %s trae comparacion sin el plan: %+v", p.Period, m.Currency, m)
			}
		}
	}
}

func TestResumen_PlanAnalitica_ComparaContraElPeriodoAnterior(t *testing.T) {
	v := armarVentas(t)
	ctx := context.Background()
	if _, err := v.svc.AsignarPlanComercio(ctx, v.merchant.ID, revisorDePrueba, qrpayment.PlanComercioAnalitica, qrpayment.ActorContext{}); err != nil {
		t.Fatalf("asignar plan: %v", err)
	}

	r, err := v.svc.ResumenDelComercio(ctx, v.merchant.ID, v.owner, 360, ahoraDeLaInterfaz)
	if err != nil {
		t.Fatalf("resumen: %v", err)
	}
	if r.Plan != qrpayment.PlanComercioAnalitica {
		t.Fatalf("plan = %q", r.Plan)
	}

	// Este mes (hasta el 29 a esta hora) contra septiembre hasta el 29 a esta hora.
	mes := periodoDe(t, r, qrpayment.PeriodoMes)
	if mes.PreviousFrom != "2026-09-01" || mes.PreviousTo != "2026-09-29" {
		t.Errorf("ventana anterior del mes = %s a %s", mes.PreviousFrom, mes.PreviousTo)
	}
	c := monedaDe(t, mes, "CRC")
	if c.Previous == nil || c.Previous.Gross != 60000 || c.Previous.Count != 1 {
		t.Fatalf("mes anterior comparable = %+v", c.Previous)
	}
	if c.Delta == nil || c.Delta.Gross != 100000 || c.Delta.GrossPct == nil || *c.Delta.GrossPct != 166.67 {
		t.Fatalf("variacion = %+v", c.Delta)
	}

	// Hoy no tiene ventas en la ventana de ayer hasta la misma hora: el
	// porcentaje es nulo, no infinito.
	hoy := periodoDe(t, r, qrpayment.PeriodoHoy)
	h := monedaDe(t, hoy, "CRC")
	if h.Previous == nil || h.Previous.Count != 0 || h.Delta == nil || h.Delta.GrossPct != nil {
		t.Fatalf("hoy contra ayer = previous %+v delta %+v", h.Previous, h.Delta)
	}
}

// Un cajero ve lo de hoy, lo mismo que ya veia en su inicio: las cifras del
// negocio de la semana y del mes, y la comparacion, no son suyas.
func TestResumen_UnCajeroSoloVeHoy(t *testing.T) {
	v := armarVentas(t)
	ctx := context.Background()
	if _, err := v.svc.AsignarPlanComercio(ctx, v.merchant.ID, revisorDePrueba, qrpayment.PlanComercioAnalitica, qrpayment.ActorContext{}); err != nil {
		t.Fatalf("asignar plan: %v", err)
	}

	r, err := v.svc.ResumenDelComercio(ctx, v.merchant.ID, v.employee, 360, ahoraDeLaInterfaz)
	if err != nil {
		t.Fatalf("resumen del cajero: %v", err)
	}
	if len(r.Periods) != 1 || r.Periods[0].Period != qrpayment.PeriodoHoy {
		t.Fatalf("periodos del cajero = %+v, se esperaba solo hoy", r.Periods)
	}
	if c := monedaDe(t, r.Periods[0], "CRC"); c.Gross != 100000 || c.Previous != nil || c.Delta != nil {
		t.Errorf("hoy del cajero = %+v (sin comparacion)", c)
	}
}

func TestResumen_QuienNoEsDelEquipoNoLoLee(t *testing.T) {
	v := armarVentas(t)
	if _, err := v.svc.ResumenDelComercio(context.Background(), v.merchant.ID, v.payer, 360, ahoraDeLaInterfaz); err == nil {
		t.Fatal("quien no es del equipo no puede leer el resumen")
	}
}

// Un comercio sin ventas en un periodo dice cero porque el servidor lo conto:
// la lista de monedas va vacia, no ausente.
func TestResumen_SinVentasLasMonedasVanVacias(t *testing.T) {
	svc, _, _, owner := setupQR(t)
	m := comercioVerificado(t, svc, owner)

	r, err := svc.ResumenDelComercio(context.Background(), m.ID, owner, 360, ahoraDeLaInterfaz)
	if err != nil {
		t.Fatalf("resumen: %v", err)
	}
	for _, p := range r.Periods {
		if p.Currencies == nil || len(p.Currencies) != 0 {
			t.Errorf("%s: monedas = %#v, se esperaba una lista vacia", p.Period, p.Currencies)
		}
	}
	cuerpo, err := json.Marshal(r)
	if err != nil {
		t.Fatalf("json: %v", err)
	}
	var plano map[string]any
	if err := json.Unmarshal(cuerpo, &plano); err != nil {
		t.Fatalf("json: %v", err)
	}
	for _, p := range plano["periods"].([]any) {
		if _, ok := p.(map[string]any)["currencies"].([]any); !ok {
			t.Errorf("currencies no salio como lista: %v", p)
		}
	}
}

func TestHandlerResumen_Responde200ConLosPeriodos(t *testing.T) {
	v := armarVentas(t)
	h := qrpayment.NewHandler(v.svc)

	rec := httptest.NewRecorder()
	h.GetMerchantSummary(rec, peticion(http.MethodGet, "/api/v1/qr/merchants/"+v.merchant.ID+"/summary?tz=360", "", v.owner, v.merchant.ID))
	if rec.Code != http.StatusOK {
		t.Fatalf("= %d %s", rec.Code, rec.Body.String())
	}
	var sobre struct {
		Data qrpayment.ResumenDelComercio `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &sobre); err != nil {
		t.Fatalf("respuesta ilegible: %v", err)
	}
	if len(sobre.Data.Periods) != 4 {
		t.Errorf("periodos = %d", len(sobre.Data.Periods))
	}

	rec = httptest.NewRecorder()
	h.GetMerchantSummary(rec, peticion(http.MethodGet, "/api/v1/qr/merchants/"+v.merchant.ID+"/summary", "", v.payer, v.merchant.ID))
	if rec.Code != http.StatusNotFound {
		t.Errorf("un ajeno: %d, se esperaba 404", rec.Code)
	}
}

// ── Retiros ─────────────────────────────────────────────────────────────────

func TestRetiros_SeListanPorPeriodoYSoloLosVeElDuenoOElEncargado(t *testing.T) {
	v := armarVentas(t)
	ctx := context.Background()

	r1, err := v.svc.WithdrawToOwner(ctx, v.merchant.ID, v.owner, "CRC", 50000, "retiro-interfaz-1")
	if err != nil {
		t.Fatalf("retiro de hoy: %v", err)
	}
	r2, err := v.svc.WithdrawToOwner(ctx, v.merchant.ID, v.owner, "CRC", 30000, "retiro-interfaz-2")
	if err != nil {
		t.Fatalf("retiro del mes pasado: %v", err)
	}
	if _, err := v.pool.Exec(ctx, `UPDATE transactions SET created_at = '2026-10-29T14:00:00Z' WHERE id = $1::uuid`, r1.TransactionID); err != nil {
		t.Fatalf("mover retiro: %v", err)
	}
	if _, err := v.pool.Exec(ctx, `UPDATE transactions SET created_at = '2026-09-20T14:00:00Z' WHERE id = $1::uuid`, r2.TransactionID); err != nil {
		t.Fatalf("mover retiro: %v", err)
	}

	hoy, err := v.svc.RetirosDelComercio(ctx, v.merchant.ID, v.owner, qrpayment.PeriodoHoy, 360, ahoraDeLaInterfaz)
	if err != nil {
		t.Fatalf("retiros de hoy: %v", err)
	}
	if len(hoy) != 1 || hoy[0].ID != r1.TransactionID || hoy[0].Amount != 50000 || hoy[0].Currency != "CRC" || hoy[0].Status != "completed" {
		t.Fatalf("retiros de hoy = %+v", hoy)
	}
	if hoy[0].WithdrawnByName != nombreDe(t, v.pool, v.owner) {
		t.Errorf("quien retiro = %q, se esperaba %q", hoy[0].WithdrawnByName, nombreDe(t, v.pool, v.owner))
	}

	pasado, err := v.svc.RetirosDelComercio(ctx, v.merchant.ID, v.owner, qrpayment.PeriodoMesAnterior, 360, ahoraDeLaInterfaz)
	if err != nil || len(pasado) != 1 || pasado[0].ID != r2.TransactionID {
		t.Fatalf("retiros del mes anterior = %+v (err %v)", pasado, err)
	}

	// El cajero no ve el saldo del negocio, ni lo que se retira de el.
	if _, err := v.svc.RetirosDelComercio(ctx, v.merchant.ID, v.employee, qrpayment.PeriodoHoy, 360, ahoraDeLaInterfaz); err == nil {
		t.Fatal("un cajero no puede leer los retiros del negocio")
	}
	if _, err := v.svc.RetirosDelComercio(ctx, v.merchant.ID, v.payer, qrpayment.PeriodoHoy, 360, ahoraDeLaInterfaz); err == nil {
		t.Fatal("quien no es del equipo no puede leer los retiros")
	}
}

func TestRetiros_UnRetiroDeOtroComercioNoSeMezcla(t *testing.T) {
	v := armarVentas(t)
	ctx := context.Background()
	otro := registrarComercio(t, v.svc, v.owner, "Otra Soda")

	r, err := v.svc.WithdrawToOwner(ctx, v.merchant.ID, v.owner, "CRC", 10000, "retiro-propio")
	if err != nil {
		t.Fatalf("retiro: %v", err)
	}
	if _, err := v.pool.Exec(ctx, `UPDATE transactions SET created_at = '2026-10-29T14:00:00Z' WHERE id = $1::uuid`, r.TransactionID); err != nil {
		t.Fatalf("mover retiro: %v", err)
	}

	retiros, err := v.svc.RetirosDelComercio(ctx, otro.ID, v.owner, qrpayment.PeriodoHoy, 360, ahoraDeLaInterfaz)
	if err != nil {
		t.Fatalf("retiros del otro: %v", err)
	}
	if len(retiros) != 0 {
		t.Fatalf("el otro comercio ve retiros que no son suyos: %+v", retiros)
	}
}

// ── El reporte y su CSV por periodo ─────────────────────────────────────────

func TestReporteDelPeriodo_ElMesAnteriorEsEntero(t *testing.T) {
	v := armarVentas(t)
	ctx := context.Background()

	rep, err := v.svc.MerchantReportDelPeriodo(ctx, v.merchant.ID, v.owner, qrpayment.PeriodoMesAnterior, 360, ahoraDeLaInterfaz)
	if err != nil {
		t.Fatalf("reporte: %v", err)
	}
	if rep.From != "2026-09-01" || rep.To != "2026-09-30" || rep.Days != 30 {
		t.Errorf("ventana = %s a %s (%d dias)", rep.From, rep.To, rep.Days)
	}
	// Solo la de septiembre: ni lo de octubre ni lo anterior a septiembre.
	if rep.Totals.Gross != 60000 || rep.Totals.Count != 1 || len(rep.Daily) != 1 || rep.Daily[0].Date != "2026-09-15" {
		t.Errorf("totales = %+v diario = %+v", rep.Totals, rep.Daily)
	}

	mes, err := v.svc.MerchantReportDelPeriodo(ctx, v.merchant.ID, v.owner, qrpayment.PeriodoMes, 360, ahoraDeLaInterfaz)
	if err != nil {
		t.Fatalf("reporte del mes: %v", err)
	}
	if mes.From != "2026-10-01" || mes.To != "2026-10-29" || mes.Days != 29 {
		t.Errorf("ventana del mes = %s a %s (%d dias)", mes.From, mes.To, mes.Days)
	}
	// El reporte suma sin separar monedas (es de antes de esta pantalla); aqui
	// solo importa que la ventana sea la del periodo y no incluya septiembre.
	if mes.Totals.Count != 4 {
		t.Errorf("cobros del mes = %d, se esperaban 4 (3 en colones y 1 en dolares)", mes.Totals.Count)
	}
}

func TestReporteExportableDelPeriodo_ExigeElPlanAnalitica(t *testing.T) {
	v := armarVentas(t)
	ctx := context.Background()

	if _, err := v.svc.ReporteExportableDelPeriodo(ctx, v.merchant.ID, v.owner, qrpayment.PeriodoMes, 360, ahoraDeLaInterfaz); !errors.Is(err, qrpayment.ErrPlanAnaliticaRequerido) {
		t.Fatalf("sin el plan: %v, se esperaba ErrPlanAnaliticaRequerido", err)
	}
	// Y el rol se comprueba antes que el plan: un ajeno no se entera del plan.
	if _, err := v.svc.ReporteExportableDelPeriodo(ctx, v.merchant.ID, v.payer, qrpayment.PeriodoMes, 360, ahoraDeLaInterfaz); errors.Is(err, qrpayment.ErrPlanAnaliticaRequerido) || err == nil {
		t.Fatalf("un ajeno: %v, se esperaba no encontrado", err)
	}

	if _, err := v.svc.AsignarPlanComercio(ctx, v.merchant.ID, revisorDePrueba, qrpayment.PlanComercioAnalitica, qrpayment.ActorContext{}); err != nil {
		t.Fatalf("asignar plan: %v", err)
	}
	rep, err := v.svc.ReporteExportableDelPeriodo(ctx, v.merchant.ID, v.owner, qrpayment.PeriodoMesAnterior, 360, ahoraDeLaInterfaz)
	if err != nil {
		t.Fatalf("con el plan: %v", err)
	}
	if rep.From != "2026-09-01" || rep.To != "2026-09-30" {
		t.Errorf("ventana = %s a %s", rep.From, rep.To)
	}
	// El mes anterior se compara con el mes de antes, entero.
	if rep.Comparison == nil || rep.Comparison.PreviousFrom != "2026-08-01" || rep.Comparison.PreviousTo != "2026-08-31" {
		t.Errorf("comparacion = %+v", rep.Comparison)
	}
}

func TestHandlerReporteCSV_ConPeriodoSeExportaEseMes(t *testing.T) {
	v := armarVentas(t)
	ctx := context.Background()
	h := qrpayment.NewHandler(v.svc)

	rec := httptest.NewRecorder()
	h.GetMerchantReportCSV(rec, peticion(http.MethodGet,
		"/api/v1/qr/merchants/"+v.merchant.ID+"/report.csv?period=prev_month&tz=360", "", v.owner, v.merchant.ID))
	if rec.Code != http.StatusForbidden || codigoDeError(t, rec) != "PLAN_REQUIRED" {
		t.Fatalf("sin el plan: %d %s, se esperaba 403 PLAN_REQUIRED", rec.Code, rec.Body.String())
	}

	if _, err := v.svc.AsignarPlanComercio(ctx, v.merchant.ID, revisorDePrueba, qrpayment.PlanComercioAnalitica, qrpayment.ActorContext{}); err != nil {
		t.Fatalf("asignar plan: %v", err)
	}
	rec = httptest.NewRecorder()
	h.GetMerchantReportCSV(rec, peticion(http.MethodGet,
		"/api/v1/qr/merchants/"+v.merchant.ID+"/report.csv?period=year&tz=360", "", v.owner, v.merchant.ID))
	if rec.Code != http.StatusBadRequest || codigoDeError(t, rec) != "INVALID_PERIOD" {
		t.Fatalf("periodo inexistente: %d %s, se esperaba 400 INVALID_PERIOD", rec.Code, rec.Body.String())
	}
}

// ── El nombre del dueno, para quien trabaja en el comercio ─────────────────

func TestMisComercios_ElCajeroVeElNombreDelDueno(t *testing.T) {
	v := armarVentas(t)

	delCajero, err := v.svc.GetMerchants(context.Background(), v.employee)
	if err != nil || len(delCajero) != 1 {
		t.Fatalf("comercios del cajero = %+v (err %v)", delCajero, err)
	}
	if delCajero[0].Role != "cashier" || delCajero[0].OwnerName != nombreDe(t, v.pool, v.owner) {
		t.Errorf("rol=%q dueno=%q, se esperaba cashier y %q", delCajero[0].Role, delCajero[0].OwnerName, nombreDe(t, v.pool, v.owner))
	}
}
