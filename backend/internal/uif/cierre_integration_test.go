package uif_test

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/kiramopay/backend/internal/testutil"
	"github.com/kiramopay/backend/internal/uif"
)

// Estas pruebas fijan el reloj del servicio: el borde del mes y el cierre no
// pueden depender del dia en que corra la prueba.

// enCR arma un instante con la hora de pared de Costa Rica.
func enCR(anio int, mes time.Month, dia, hora, minuto int) time.Time {
	return time.Date(anio, mes, dia, hora, minuto, 0, 0, horaCR)
}

func servicioA(pool *pgxpool.Pool, ahora time.Time, porDolar map[string]float64) *uif.Service {
	opts := &uif.Options{Ahora: func() time.Time { return ahora }}
	if porDolar != nil {
		opts.TipoDeCambio = tasaFija(porDolar)
	}
	return uif.NewService(uif.NewRepository(pool), opts)
}

type casoDelMes struct {
	tipo, mes, razon      string
	monto, salidas, entra int64
}

func casosConMes(t *testing.T, pool *pgxpool.Pool, userID string) []casoDelMes {
	t.Helper()
	rows, err := pool.Query(context.Background(), `
		SELECT report_type, COALESCE(mes::text, ''), reason, amount_minor,
		       COALESCE(salidas_mes_usd_minor, 0), COALESCE(entradas_mes_usd_minor, 0)
		  FROM uif_reports WHERE user_id = $1::uuid ORDER BY created_at`, userID)
	if err != nil {
		t.Fatalf("leer casos: %v", err)
	}
	defer rows.Close()
	var out []casoDelMes
	for rows.Next() {
		var c casoDelMes
		if err := rows.Scan(&c.tipo, &c.mes, &c.razon, &c.monto, &c.salidas, &c.entra); err != nil {
			t.Fatalf("scan: %v", err)
		}
		out = append(out, c)
	}
	return out
}

// El borde del mes es la medianoche de Costa Rica. Con el reloj a las 11:30 de
// la noche del 31 de marzo, lo del primer minuto de marzo cuenta y lo del
// ultimo minuto de febrero no, aunque en UTC ese minuto ya sea 1 de marzo.
func TestUIF_ElBordeDelMesEsLaMedianocheDeCostaRica(t *testing.T) {
	_, _, pool, userID := setupUIF(t)
	ctx := context.Background()
	ahora := enCR(2026, time.March, 31, 23, 30)
	svc := servicioA(pool, ahora, map[string]float64{"CRC": 550})

	movimientoEn(t, pool, userID, "sinpe_send", "USD", 520_000, enCR(2026, time.February, 28, 23, 59))
	movimientoEn(t, pool, userID, "sinpe_send", "USD", 470_000, enCR(2026, time.March, 1, 0, 1))
	tx := movimientoEn(t, pool, userID, "sinpe_send", "USD", 20_000, ahora)
	svc.Report(ctx, userID, tx, "USD", 20_000)

	// Marzo: US$4.700 + US$200. Febrero no entra: no hay caso. (Contado en UTC,
	// los US$5.200 de febrero serian de marzo y el mes cruzaria aqui.)
	if casos := casosConMes(t, pool, userID); len(casos) != 0 {
		t.Fatalf("casos = %+v: el ultimo minuto de febrero (hora de CR) no es de marzo", casos)
	}

	// Con US$5.100 mas de marzo, el mes cruza: US$4.900 + US$5.100.
	otro := movimientoEn(t, pool, userID, "sinpe_send", "USD", 510_000, ahora)
	svc.Report(ctx, userID, otro, "USD", 510_000)
	casos := casosConMes(t, pool, userID)
	if len(casos) != 1 || casos[0].tipo != uif.TypeMultiplesMes || casos[0].mes != "2026-03-01" {
		t.Fatalf("casos = %+v, se esperaba uno multiples_mes de 2026-03", casos)
	}
	if casos[0].salidas != 1_000_000 {
		t.Fatalf("salidas del mes en el caso = %d, se esperaba 1000000", casos[0].salidas)
	}
}

// Un movimiento que ya se evaluo no se evalua otra vez. Los US$9.000 no
// cruzaban nada; despues salieron US$2.000 mas. Si el aviso repetido de un
// reintento volviera a evaluar los US$9.000, el dia y el mes cruzarian "con
// ellos" y se abriria un caso a nombre de un movimiento que no cruzo nada.
func TestUIF_UnMovimientoSeEvaluaUnaSolaVez(t *testing.T) {
	_, _, pool, userID := setupUIF(t)
	ctx := context.Background()
	ahora := enCR(2026, time.March, 10, 12, 0)
	svc := servicioA(pool, ahora, map[string]float64{"CRC": 550})

	tx := movimientoEn(t, pool, userID, "sinpe_send", "USD", 900_000, ahora)
	svc.Report(ctx, userID, tx, "USD", 900_000)
	movimientoEn(t, pool, userID, "sinpe_send", "USD", 200_000, ahora)
	svc.Report(ctx, userID, tx, "USD", 900_000)

	if casos := casosConMes(t, pool, userID); len(casos) != 0 {
		t.Fatalf("casos = %+v: el aviso repetido volvio a evaluar el movimiento", casos)
	}
	var registros int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM uif_movimientos WHERE tx_id = $1::uuid`, tx).Scan(&registros); err != nil {
		t.Fatalf("contar registros: %v", err)
	}
	if registros != 1 {
		t.Fatalf("registros del movimiento = %d, se esperaba 1", registros)
	}
}

// Los 30 dias moviles son una alerta INTERNA de estructuracion. Veinte dias de
// ₡250.000 hasta el 10 de marzo, mas ₡600.000 hoy: once de esos dias son de
// febrero, asi que marzo suma ₡2.850.000 (US$5.181,82) y no cruza; los 30 dias
// suman ₡5.600.000 (US$10.181,82) y abren la alerta, con su tipo propio. La
// salida de hace 40 dias no cuenta.
func TestUIF_LosTreintaDiasSonUnaAlertaInterna(t *testing.T) {
	_, _, pool, userID := setupUIF(t)
	ctx := context.Background()
	ahora := enCR(2026, time.March, 10, 12, 0)
	svc := servicioA(pool, ahora, map[string]float64{"CRC": 550})

	for d := 20; d >= 1; d-- {
		movimientoEn(t, pool, userID, "sinpe_send", "CRC", 25_000_000, ahora.AddDate(0, 0, -d))
	}
	movimientoEn(t, pool, userID, "sinpe_send", "CRC", 300_000_000, ahora.AddDate(0, 0, -40))
	hoy := movimientoEn(t, pool, userID, "sinpe_send", "CRC", 60_000_000, ahora)
	svc.Report(ctx, userID, hoy, "CRC", 60_000_000)

	casos := casosDe(t, pool, userID, uif.TypeEstructuracion30)
	if len(casos) != 1 {
		t.Fatalf("casos estructuracion_30d = %d, se esperaba 1", len(casos))
	}
	if want := int64(20*25_000_000 + 60_000_000); casos[0] != want {
		t.Fatalf("acumulado registrado = %d, se esperaba %d (la salida de hace 40 dias no cuenta)", casos[0], want)
	}
	if n := contarCasos(t, pool, userID, uif.TypeMultiplesMes); n != 0 {
		t.Fatalf("casos multiples_mes = %d: marzo no cruza", n)
	}
	if n := contarCasos(t, pool, userID, uif.TypeAcumulado30); n != 0 {
		t.Fatalf("casos acumulado_30d = %d: ese tipo ya no se abre", n)
	}

	// Una salida mas, ya por encima: no se repite la alerta.
	otra := movimientoEn(t, pool, userID, "sinpe_send", "CRC", 1_000_000, ahora)
	svc.Report(ctx, userID, otra, "CRC", 1_000_000)
	if n := len(casosDe(t, pool, userID, uif.TypeEstructuracion30)); n != 1 {
		t.Fatalf("casos tras seguir por encima = %d, se esperaba 1", n)
	}
}

// El cierre convierte el total del mes con la venta del ULTIMO DIA del mes: ni
// con la de cada dia ni con la del dia en que corre el cierre. ₡5.000.000 del 3
// de marzo: a 560 (su dia) son US$8.928,57 y a 520 (el 1 de abril) US$9.615,38;
// a 500 (el 31 de marzo) son US$10.000 justos, y con ">=" llegan.
func TestUIF_ElCierreUsaLaVentaDelUltimoDiaDelMes(t *testing.T) {
	_, _, pool, userID := setupUIF(t)
	ctx := context.Background()
	ventaDelDia(t, pool, "CRC", "2026-03-03", 560)
	ventaDelDia(t, pool, "CRC", "2026-03-31", 500)
	ventaDelDia(t, pool, "CRC", "2026-04-01", 520)
	movimientoEn(t, pool, userID, "sinpe_send", "CRC", 500_000_000, enCR(2026, time.March, 3, 9, 0))

	svc := servicioA(pool, enCR(2026, time.April, 2, 10, 0), nil)
	marzo := uif.MesDe(enCR(2026, time.March, 15, 0, 0))
	res, err := svc.CerrarMes(ctx, marzo)
	if err != nil {
		t.Fatalf("CerrarMes: %v", err)
	}
	if res.YaCerrado || res.Clientes != 1 || res.Casos != 1 {
		t.Fatalf("resumen = %+v, se esperaba 1 cliente y 1 caso", res)
	}
	casos := casosConMes(t, pool, userID)
	if len(casos) != 1 || casos[0].tipo != uif.TypeCierreMes || casos[0].mes != "2026-03-01" {
		t.Fatalf("casos = %+v, se esperaba uno cierre_mes de 2026-03", casos)
	}
	if casos[0].salidas != 1_000_000 || casos[0].monto != 1_000_000 {
		t.Fatalf("caso: salidas %d, monto %d; se esperaba 1000000 en las dos", casos[0].salidas, casos[0].monto)
	}
	for _, dato := range []string{"2026-03-31", "500.00", "las salidas del mes"} {
		if !strings.Contains(casos[0].razon, dato) {
			t.Fatalf("la razon %q no dice %q", casos[0].razon, dato)
		}
	}

	// Un mes se cierra una sola vez.
	otra, err := svc.CerrarMes(ctx, marzo)
	if err != nil {
		t.Fatalf("segundo CerrarMes: %v", err)
	}
	if !otra.YaCerrado {
		t.Fatalf("el segundo cierre no vio el primero: %+v", otra)
	}
	if n := len(casosConMes(t, pool, userID)); n != 1 {
		t.Fatalf("casos tras cerrar dos veces = %d, se esperaba 1", n)
	}
}

// El cierre recorre todos los movimientos del mes, tambien los que entraron por
// caminos que no le avisan a la UIF (lo que cobra un vendedor en escrow), y
// mide entradas y bruto. US$6.000 entraron y US$4.000 salieron: el bruto llega.
// Lo del 1 de abril a las 00:00 de Costa Rica ya no es de marzo; lo del 31 a
// las 9 de la noche (1 de abril en UTC) si.
func TestUIF_ElCierreVeEntradasYBrutoDelMesDeCostaRica(t *testing.T) {
	_, _, pool, userID := setupUIF(t)
	ctx := context.Background()
	movimientoEn(t, pool, userID, "escrow_receive", "USD", 600_000, enCR(2026, time.March, 31, 21, 0))
	movimientoEn(t, pool, userID, "sinpe_send", "USD", 400_000, enCR(2026, time.March, 12, 8, 0))
	movimientoEn(t, pool, userID, "deposit", "USD", 900_000, enCR(2026, time.April, 1, 0, 0))

	svc := servicioA(pool, enCR(2026, time.April, 2, 10, 0), nil)
	if _, err := svc.CerrarMes(ctx, uif.MesDe(enCR(2026, time.March, 15, 0, 0))); err != nil {
		t.Fatalf("CerrarMes: %v", err)
	}
	casos := casosConMes(t, pool, userID)
	if len(casos) != 1 || casos[0].tipo != uif.TypeCierreMes {
		t.Fatalf("casos = %+v, se esperaba uno cierre_mes por el bruto", casos)
	}
	if casos[0].salidas != 400_000 || casos[0].entra != 600_000 {
		t.Fatalf("caso: salidas %d, entradas %d; se esperaba 400000 y 600000", casos[0].salidas, casos[0].entra)
	}
	if !strings.Contains(casos[0].razon, "el bruto del mes") || strings.Contains(casos[0].razon, "las entradas del mes") {
		t.Fatalf("la razon %q tiene que decir que cruzo el bruto y no las entradas", casos[0].razon)
	}
}

// Un cliente con una moneda sin tipo de cambio que sin ella no llega va a
// revision manual al cerrar: un total incompleto no dice que no cruzo.
func TestUIF_ElCierreSinTipoDeCambioEsManual(t *testing.T) {
	_, _, pool, userID := setupUIF(t)
	ctx := context.Background()
	movimientoEn(t, pool, userID, "sinpe_receive", "GTQ", 5_000_000, enCR(2026, time.March, 5, 9, 0))
	movimientoEn(t, pool, userID, "sinpe_send", "USD", 100_000, enCR(2026, time.March, 6, 9, 0))

	svc := servicioA(pool, enCR(2026, time.April, 2, 10, 0), nil)
	res, err := svc.CerrarMes(ctx, uif.MesDe(enCR(2026, time.March, 15, 0, 0)))
	if err != nil {
		t.Fatalf("CerrarMes: %v", err)
	}
	casos := casosConMes(t, pool, userID)
	if len(casos) != 1 || casos[0].tipo != uif.TypeManual || casos[0].mes != "2026-03-01" {
		t.Fatalf("casos = %+v, se esperaba uno manual de 2026-03", casos)
	}
	if !strings.Contains(casos[0].razon, "GTQ") || !strings.Contains(res.Tasas, "GTQ sin tipo de cambio") {
		t.Fatalf("el caso (%q) o el resumen (%q) no dicen que falto el quetzal", casos[0].razon, res.Tasas)
	}
}

// Un mes que todavia no termino no se cierra, y tampoco el primer dia del mes
// siguiente: lo que se creo el 31 a ultima hora y completa despues tiene un dia
// para entrar a la cuenta.
func TestUIF_NoSeCierraUnMesSinTerminar(t *testing.T) {
	_, _, pool, _ := setupUIF(t)
	marzo := uif.MesDe(enCR(2026, time.March, 15, 0, 0))
	for _, ahora := range []time.Time{enCR(2026, time.March, 31, 23, 59), enCR(2026, time.April, 1, 23, 59)} {
		svc := servicioA(pool, ahora, nil)
		if _, err := svc.CerrarMes(context.Background(), marzo); !errors.Is(err, uif.ErrMesSinTerminar) {
			t.Fatalf("a las %s: err = %v, se esperaba ErrMesSinTerminar", ahora, err)
		}
	}
	if _, err := servicioA(pool, enCR(2026, time.April, 2, 0, 0), nil).CerrarMes(context.Background(), marzo); err != nil {
		t.Fatalf("el 2 de abril: %v", err)
	}
}

// El cierre corre solo: al arrancar, el servicio cierra el mes anterior.
func TestUIF_ElMesAnteriorSeCierraSolo(t *testing.T) {
	_, _, pool, userID := setupUIF(t)
	movimientoEn(t, pool, userID, "deposit", "USD", 1_200_000, enCR(2026, time.March, 20, 9, 0))
	svc := servicioA(pool, enCR(2026, time.April, 2, 0, 30), nil)

	ctx, cancelar := context.WithCancel(context.Background())
	defer cancelar()
	svc.IniciarCierres(ctx, time.Hour)

	limite := time.Now().Add(10 * time.Second)
	for {
		var cerrado bool
		if err := pool.QueryRow(context.Background(),
			`SELECT EXISTS (SELECT 1 FROM uif_cierres WHERE mes = '2026-03-01')`).Scan(&cerrado); err != nil {
			t.Fatalf("leer los cierres: %v", err)
		}
		if cerrado {
			break
		}
		if time.Now().After(limite) {
			t.Fatal("en diez segundos marzo no se cerro")
		}
		time.Sleep(50 * time.Millisecond)
	}
	if n := contarCasos(t, pool, userID, uif.TypeCierreMes); n != 1 {
		t.Fatalf("casos cierre_mes = %d, se esperaba 1", n)
	}
}

// Dos clientes en el mismo cierre: cada uno con su cuenta.
func TestUIF_ElCierreEsPorCliente(t *testing.T) {
	_, _, pool, uno := setupUIF(t)
	otro := testutil.SeedTestUser2(t, pool)
	ctx := context.Background()
	movimientoEn(t, pool, uno, "sinpe_send", "USD", 600_000, enCR(2026, time.March, 2, 9, 0))
	movimientoEn(t, pool, otro, "sinpe_send", "USD", 600_000, enCR(2026, time.March, 2, 9, 0))

	svc := servicioA(pool, enCR(2026, time.April, 2, 10, 0), nil)
	res, err := svc.CerrarMes(ctx, uif.MesDe(enCR(2026, time.March, 15, 0, 0)))
	if err != nil {
		t.Fatalf("CerrarMes: %v", err)
	}
	if res.Clientes != 2 || res.Casos != 0 {
		t.Fatalf("resumen = %+v: US$6.000 por cliente no llegan, aunque juntos sumen US$12.000", res)
	}
}
