package uif_test

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/kiramopay/backend/internal/uif"
)

// Pruebas de lo que encontro la revision adversaria del cambio a mes
// calendario.

// esconderTabla le cambia el nombre a una tabla mientras dura la prueba: es la
// forma de que una consulta falle por la base y no por falta de datos.
func esconderTabla(t *testing.T, pool *pgxpool.Pool, tabla string) {
	t.Helper()
	ctx := context.Background()
	if _, err := pool.Exec(ctx, `ALTER TABLE `+tabla+` RENAME TO `+tabla+`_escondida`); err != nil {
		t.Fatalf("esconder %s: %v", tabla, err)
	}
	t.Cleanup(func() { mostrarTabla(t, pool, tabla) })
}

func mostrarTabla(t *testing.T, pool *pgxpool.Pool, tabla string) {
	t.Helper()
	if _, err := pool.Exec(context.Background(),
		`ALTER TABLE IF EXISTS `+tabla+`_escondida RENAME TO `+tabla); err != nil {
		t.Fatalf("devolver %s: %v", tabla, err)
	}
}

// Si la evaluacion se corta despues de empezar (la base no responde a mitad de
// camino), el movimiento no puede quedar como "ya evaluado": el aviso repetido
// de un reintento tiene que rehacerla. Antes el registro se escribia primero, y
// el reintento encontraba el registro y no hacia nada.
func TestUIF_UnaEvaluacionQueFallaSeRehaceEnElReintento(t *testing.T) {
	_, _, pool, userID := setupUIF(t)
	ctx := context.Background()
	ahora := enCR(2026, time.March, 10, 12, 0)
	svc := servicioA(pool, ahora, map[string]float64{"CRC": 550})

	tx := movimientoEn(t, pool, userID, "sinpe_send", "USD", 1_000_000, ahora)
	esconderTabla(t, pool, "transactions")
	svc.Report(ctx, userID, tx, "USD", 1_000_000)
	mostrarTabla(t, pool, "transactions")
	if n := len(casosConMes(t, pool, userID)); n != 0 {
		t.Fatalf("con la base cortada se abrieron %d casos", n)
	}

	svc.Report(ctx, userID, tx, "USD", 1_000_000)
	casos := casosConMes(t, pool, userID)
	if len(casos) != 1 || casos[0].tipo != uif.TypeSingleThreshold {
		t.Fatalf("casos tras el reintento = %+v, se esperaba uno single_threshold", casos)
	}
}

// Una falla de la base al leer la venta del ultimo dia no es "no hay tipo de
// cambio": el cierre no puede mandar a todos a revision manual y marcar el mes
// como cerrado. Tiene que devolver el error y dejar el mes abierto para el
// proximo intento.
func TestUIF_UnaFallaDeLaBaseNoCierraElMes(t *testing.T) {
	_, _, pool, userID := setupUIF(t)
	ctx := context.Background()
	movimientoEn(t, pool, userID, "sinpe_send", "CRC", 100_000_000, enCR(2026, time.March, 3, 9, 0))
	esconderTabla(t, pool, "tipo_de_cambio_diario")

	svc := servicioA(pool, enCR(2026, time.April, 2, 10, 0), nil)
	if _, err := svc.CerrarMes(ctx, uif.MesDe(enCR(2026, time.March, 15, 0, 0))); err == nil {
		t.Fatal("el cierre no devolvio el error de la base")
	}
	var cerrado bool
	if err := pool.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM uif_cierres WHERE mes = '2026-03-01')`).Scan(&cerrado); err != nil {
		t.Fatalf("leer los cierres: %v", err)
	}
	if cerrado {
		t.Fatal("con la base fallando, marzo quedo marcado como cerrado")
	}
	if casos := casosConMes(t, pool, userID); len(casos) != 0 {
		t.Fatalf("con la base fallando se abrieron casos: %+v", casos)
	}
}

// Reprocesar un mes (borrar su marca a mano y volver a cerrarlo) no duplica los
// casos que ya abrio.
func TestUIF_ReprocesarUnMesNoDuplicaCasos(t *testing.T) {
	_, _, pool, userID := setupUIF(t)
	ctx := context.Background()
	movimientoEn(t, pool, userID, "deposit", "USD", 1_200_000, enCR(2026, time.March, 20, 9, 0))
	svc := servicioA(pool, enCR(2026, time.April, 2, 10, 0), nil)
	marzo := uif.MesDe(enCR(2026, time.March, 15, 0, 0))

	if _, err := svc.CerrarMes(ctx, marzo); err != nil {
		t.Fatalf("primer cierre: %v", err)
	}
	if _, err := pool.Exec(ctx, `DELETE FROM uif_cierres WHERE mes = '2026-03-01'`); err != nil {
		t.Fatalf("borrar la marca: %v", err)
	}
	res, err := svc.CerrarMes(ctx, marzo)
	if err != nil {
		t.Fatalf("segundo cierre: %v", err)
	}
	if n := contarCasos(t, pool, userID, uif.TypeCierreMes); n != 1 || res.Casos != 0 {
		t.Fatalf("tras reprocesar: %d casos cierre_mes (el resumen dice %d nuevos); se esperaba 1 y 0", n, res.Casos)
	}
}

// Una moneda sin tipo de cambio en el mes deja el total incompleto, y eso va a
// revision UNA vez por cliente y mes, no con cada movimiento que sigue.
func TestUIF_UnMesSinTipoDeCambioVaARevisionUnaVez(t *testing.T) {
	_, _, pool, userID := setupUIF(t)
	ctx := context.Background()
	ahora := enCR(2026, time.March, 10, 12, 0)
	svc := servicioA(pool, ahora, map[string]float64{"CRC": 550})

	movimientoEn(t, pool, userID, "sinpe_receive", "GTQ", 5_000_000, enCR(2026, time.March, 2, 9, 0))
	for _, monto := range []int64{10_000, 20_000} {
		tx := movimientoEn(t, pool, userID, "sinpe_send", "USD", monto, ahora)
		svc.Report(ctx, userID, tx, "USD", monto)
	}
	casos := casosConMes(t, pool, userID)
	if len(casos) != 1 || casos[0].tipo != uif.TypeManual || !strings.Contains(casos[0].razon, "GTQ") {
		t.Fatalf("casos = %+v, se esperaba uno solo manual por el quetzal", casos)
	}
}

// Sin venta del dia guardada, la tasa del historial de exchange_rates vale
// desde la ultima vez que la fuente la confirmo, no desde que cambio: una tasa
// que no se movio en veinte dias pero se confirmo hoy no es vieja.
func TestUIF_UnaTasaDelHistorialConfirmadaHoyNoAlarma(t *testing.T) {
	_, _, pool, userID := setupUIF(t)
	svc := uif.NewService(uif.NewRepository(pool), nil)
	log := capturarLog(t)
	ctx := context.Background()

	if _, err := pool.Exec(ctx, `
		INSERT INTO exchange_rates (from_currency, to_currency, rate, source, updated_at, effective_from)
		VALUES ('USD', 'CRC', 500, 'hacienda', NOW(), NOW() - INTERVAL '20 days')`); err != nil {
		t.Fatalf("sembrar la tasa: %v", err)
	}
	ahora := time.Now()
	tx := movimientoEn(t, pool, userID, "sinpe_send", "CRC", 1_000_000, ahora)
	svc.Report(ctx, userID, tx, "CRC", 1_000_000)

	var fecha, fuente string
	if err := pool.QueryRow(ctx,
		`SELECT tasa_fecha::text, tasa_fuente FROM uif_movimientos WHERE tx_id = $1::uuid`, tx).Scan(&fecha, &fuente); err != nil {
		t.Fatalf("leer el registro: %v", err)
	}
	if fecha != diaCR(ahora) || fuente != uif.FuenteHistorial {
		t.Fatalf("tasa del %s (%s), se esperaba la de hoy %s del historial", fecha, fuente, diaCR(ahora))
	}
	if strings.Contains(log.String(), "tipo de cambio viejo") {
		t.Fatalf("una tasa confirmada hoy dio la alarma:\n%s", log.String())
	}
}

// Un total del mes en cero es un dato, no un campo que falta: un cliente que
// solo recibio tiene salidas en cero, y el JSON tiene que decirlo.
func TestUIF_LosTotalesDelMesSeVenAunqueSeanCero(t *testing.T) {
	b, err := json.Marshal(uif.Report{Mes: "2026-03-01", EntradasMesUSD: 1_200_000})
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}
	if !strings.Contains(string(b), `"salidas_mes_usd_minor":0`) {
		t.Fatalf("el caso no dice que las salidas del mes fueron cero: %s", b)
	}
}
