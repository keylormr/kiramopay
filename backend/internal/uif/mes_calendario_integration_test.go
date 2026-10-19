package uif_test

import (
	"bytes"
	"context"
	"log/slog"
	"math"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/kiramopay/backend/internal/testutil"
	"github.com/kiramopay/backend/internal/transaction"
	"github.com/kiramopay/backend/internal/uif"
)

// SUGEF 13-19, art. 20 y Lineamiento 22.2: las transacciones multiples se
// acumulan por cliente en el MES CALENDARIO, por cualquier medio de pago, y el
// registro se dispara al llegar a US$10.000. El codigo media una ventana movil
// de 30 dias de salidas, convertida con el tipo de cambio de hoy: con eso un
// movimiento del mes pasado contaba para este, las entradas no contaban nunca y
// el colon de hace tres semanas valia lo que vale hoy.
//
// El dia de Costa Rica es UTC-6 todo el ano: el pais no tiene horario de verano.

var horaCR = time.FixedZone("CR", -6*3600)

func inicioDelMesCR(t time.Time) time.Time {
	l := t.In(horaCR)
	return time.Date(l.Year(), l.Month(), 1, 0, 0, 0, 0, horaCR)
}

func diaCR(t time.Time) string { return t.In(horaCR).Format(time.DateOnly) }

// movimientoEn inserta un movimiento completado del tipo dado en un instante
// dado. created_date lleva la fecha del servidor (UTC), como en produccion.
func movimientoEn(t *testing.T, pool *pgxpool.Pool, userID, tipo, moneda string, monto int64, cuando time.Time) string {
	t.Helper()
	ctx := context.Background()
	var walletID string
	if err := pool.QueryRow(ctx,
		`SELECT id::text FROM wallets WHERE user_id = $1::uuid`, userID).Scan(&walletID); err != nil {
		t.Fatalf("buscar billetera: %v", err)
	}
	id := uuid.New().String()
	if _, err := pool.Exec(ctx, `
		INSERT INTO transactions (id, wallet_id, user_id, type, amount, currency, status,
		                          created_at, completed_at, created_date)
		VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, 'completed', $7, $7, $8::date)`,
		id, walletID, userID, tipo, monto, moneda, cuando.UTC(), cuando.UTC().Format(time.DateOnly)); err != nil {
		t.Fatalf("insertar %s: %v", tipo, err)
	}
	return id
}

// ventaDelDia guarda la venta de referencia del BCCR de un dia: cuantas
// unidades de la moneda vale un dolar.
func ventaDelDia(t *testing.T, pool *pgxpool.Pool, moneda, fecha string, porDolar float64) {
	t.Helper()
	if _, err := pool.Exec(context.Background(), `
		INSERT INTO tipo_de_cambio_diario (moneda, fecha, por_dolar, fuente)
		VALUES ($1, $2::date, $3, 'hacienda')`, moneda, fecha, porDolar); err != nil {
		t.Fatalf("guardar la venta de %s del %s: %v", moneda, fecha, err)
	}
}

func contarCasos(t *testing.T, pool *pgxpool.Pool, userID, tipo string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM uif_reports WHERE user_id = $1::uuid AND report_type = $2`,
		userID, tipo).Scan(&n); err != nil {
		t.Fatalf("contar casos %s: %v", tipo, err)
	}
	return n
}

// Un mes de salidas que cruza el umbral abre el caso REGULATORIO del mes, y el
// caso dice de que mes es. Los US$9.500 salieron el primer minuto del mes en
// hora de Costa Rica: el dia no los ve, el mes si.
func TestUIF_ElMesCalendarioAbreElCasoRegulatorio(t *testing.T) {
	_, _, pool, userID := setupUIF(t)
	ahora := enCR(2026, time.October, 18, 12, 0)
	svc := servicioA(pool, ahora, map[string]float64{"CRC": 550})
	ctx := context.Background()

	movimientoEn(t, pool, userID, "sinpe_send", "USD", 950_000, enCR(2026, time.October, 1, 0, 1))
	tx := movimientoEn(t, pool, userID, "sinpe_send", "USD", 60_000, ahora)
	svc.Report(ctx, userID, tx, "USD", 60_000)

	casos := casosDelUsuario(t, pool, userID)
	if len(casos) != 1 || casos[0].tipo != "multiples_mes" {
		t.Fatalf("casos = %+v, se esperaba uno multiples_mes: el mes calendario es el acumulado regulatorio", casos)
	}
	var mes string
	if err := pool.QueryRow(ctx,
		`SELECT mes::text FROM uif_reports WHERE user_id = $1::uuid`, userID).Scan(&mes); err != nil {
		t.Fatalf("leer el mes del caso: %v", err)
	}
	if mes != "2026-10-01" {
		t.Fatalf("mes del caso = %s, se esperaba 2026-10-01", mes)
	}
}

// Lo que salio el ultimo minuto del mes pasado, en hora de Costa Rica, no es de
// este mes: el caso regulatorio no se abre. Sigue dentro de los ultimos 30
// dias, asi que la alerta INTERNA de estructuracion si lo ve, con su tipo
// propio. En UTC ese minuto ya es de este mes: una cuenta en UTC lo sumaria.
func TestUIF_ElMesPasadoNoEntraEnElCasoRegulatorio(t *testing.T) {
	_, _, pool, userID := setupUIF(t)
	ahora := enCR(2026, time.October, 18, 12, 0)
	svc := servicioA(pool, ahora, map[string]float64{"CRC": 550})
	ctx := context.Background()

	movimientoEn(t, pool, userID, "sinpe_send", "USD", 950_000, enCR(2026, time.September, 30, 23, 59))
	tx := movimientoEn(t, pool, userID, "sinpe_send", "USD", 60_000, ahora)
	svc.Report(ctx, userID, tx, "USD", 60_000)

	if n := contarCasos(t, pool, userID, "multiples_mes"); n != 0 {
		t.Fatalf("casos multiples_mes = %d: el mes pasado no cuenta para este", n)
	}
	casos := casosDelUsuario(t, pool, userID)
	if len(casos) != 1 || casos[0].tipo != "estructuracion_30d" {
		t.Fatalf("casos = %+v, se esperaba uno estructuracion_30d: los 30 dias son una alerta interna", casos)
	}
}

// Mientras el dueno y SUGEF no digan si entradas y salidas se suman, se miden
// los dos sentidos por separado y el bruto, y cualquiera que cruce va a
// revision. US$5.100 salieron y US$4.950 entraron: ningun sentido llega, el
// bruto si, con los ultimos US$100.
func TestUIF_ElBrutoDelMesTambienSeMide(t *testing.T) {
	_, _, pool, userID := setupUIF(t)
	svc := servicioConTasa(pool, map[string]float64{"CRC": 550})
	ctx := context.Background()

	ahora := time.Now()
	movimientoEn(t, pool, userID, "sinpe_send", "USD", 500_000, ahora)
	movimientoEn(t, pool, userID, "deposit", "USD", 495_000, ahora)
	tx := movimientoEn(t, pool, userID, "sinpe_send", "USD", 10_000, ahora)
	svc.Report(ctx, userID, tx, "USD", 10_000)

	casos := casosDelUsuario(t, pool, userID)
	if len(casos) != 1 || casos[0].tipo != "multiples_mes" {
		t.Fatalf("casos = %+v, se esperaba uno multiples_mes por el bruto del mes", casos)
	}
	if !strings.Contains(casos[0].razon, "el bruto del mes") || strings.Contains(casos[0].razon, "las salidas del mes") {
		t.Fatalf("la razon %q tiene que decir que cruzo el bruto, y no las salidas", casos[0].razon)
	}
}

// Las entradas solas tambien cruzan. Lo que acredita una venta de cripto (un
// credito que pide otro servicio del backend) lleva las entradas del mes de
// US$9.990 a mas de US$10.000.
func TestUIF_LasEntradasDelMesAbrenElCaso(t *testing.T) {
	_, txSvc, pool, userID := setupUIF(t)
	ctx := context.Background()

	movimientoEn(t, pool, userID, "deposit", "USD", 999_000, time.Now())
	if _, err := txSvc.CreateTransaction(ctx, userID, &transaction.CreateTransactionRequest{
		Type:           transaction.TypeCryptoSell,
		Amount:         2_000, // US$20
		Currency:       "USD",
		IdempotencyKey: "uif-entrada-1",
		Internal:       true,
	}); err != nil {
		t.Fatalf("CreateTransaction: %v", err)
	}

	casos := casosDelUsuario(t, pool, userID)
	if len(casos) != 1 || casos[0].tipo != "multiples_mes" {
		t.Fatalf("casos = %+v, se esperaba uno multiples_mes por las entradas del mes", casos)
	}
	if !strings.Contains(casos[0].razon, "las entradas del mes (US$10010.00)") {
		t.Fatalf("la razon %q no dice que cruzaron las entradas", casos[0].razon)
	}
}

// Una transferencia es salida de quien envia y ENTRADA de quien recibe. Quien
// recibe ya tenia US$9.990 de entradas este mes; ₡8.000 (US$14,55 a 550) lo
// llevan al umbral.
func TestUIF_UnaTransferenciaEsEntradaDeQuienRecibe(t *testing.T) {
	_, txSvc, pool, emisor := setupUIF(t)
	receptor := testutil.SeedTestUser2(t, pool)
	ctx := context.Background()

	movimientoEn(t, pool, receptor, "deposit", "USD", 999_000, time.Now())
	if _, _, err := txSvc.CreateTransfer(ctx, &transaction.CreateTransferRequest{
		FromUserID: emisor, ToUserID: receptor, Amount: 800_000, Currency: "CRC",
		IdempotencyKey: "uif-transferencia-1",
		TxType:         transaction.TypeP2PSend, ReceiveType: transaction.TypeP2PReceive,
	}); err != nil {
		t.Fatalf("CreateTransfer: %v", err)
	}

	casos := casosDelUsuario(t, pool, receptor)
	if len(casos) != 1 || casos[0].tipo != "multiples_mes" {
		t.Fatalf("casos de quien recibe = %+v, se esperaba uno multiples_mes", casos)
	}
}

// Cada movimiento evaluado queda registrado con su equivalente en dolares, la
// tasa, la fecha de la tasa y su fuente: la venta de referencia del BCCR del
// dia, tal como la republica Hacienda. Sin eso, el total del mes no se puede
// rehacer.
func TestUIF_CadaMovimientoGuardaSuEquivalente(t *testing.T) {
	_, _, pool, userID := setupUIF(t)
	svc := uif.NewService(uif.NewRepository(pool), nil)
	ctx := context.Background()

	ahora := time.Now()
	ventaDelDia(t, pool, "CRC", diaCR(ahora), 455.6)
	tx := movimientoEn(t, pool, userID, "sinpe_send", "CRC", 100_000_000, ahora) // ₡1.000.000
	svc.Report(ctx, userID, tx, "CRC", 100_000_000)

	var sentido, moneda, fecha, fuente, mes string
	var monto, usd int64
	var tasa float64
	if err := pool.QueryRow(ctx, `
		SELECT sentido, moneda, monto_minor, usd_minor, tasa::float8, tasa_fecha::text, tasa_fuente, mes::text
		  FROM uif_movimientos WHERE tx_id = $1::uuid`, tx).Scan(
		&sentido, &moneda, &monto, &usd, &tasa, &fecha, &fuente, &mes); err != nil {
		t.Fatalf("leer el registro del movimiento: %v", err)
	}
	// ₡1.000.000 / 455,6 = US$2.194,91.
	if sentido != "salida" || moneda != "CRC" || monto != 100_000_000 || usd != 219_491 {
		t.Fatalf("registro: %s %s %d = %d centavos de dolar; se esperaba salida CRC 100000000 = 219491",
			sentido, moneda, monto, usd)
	}
	if math.Abs(tasa-455.6) > 1e-9 || fecha != diaCR(ahora) || fuente != "hacienda" {
		t.Fatalf("tasa: %v del %s (%s); se esperaba 455.6 del %s (hacienda)", tasa, fecha, fuente, diaCR(ahora))
	}
	if want := inicioDelMesCR(ahora).Format(time.DateOnly); mes != want {
		t.Fatalf("mes del registro = %s, se esperaba %s", mes, want)
	}
}

// El acumulado del mes convierte cada movimiento con la venta del dia en que
// ocurrio, no con la de hoy. ₡4.750.000 del primer dia del mes, a 500, son
// US$9.500; con la venta de hoy (560) serian US$8.482 y los US$600 de hoy no
// cruzarian.
func TestUIF_CadaDiaSeConvierteConSuVenta(t *testing.T) {
	_, _, pool, userID := setupUIF(t)
	ahora := enCR(2026, time.October, 18, 12, 0)
	svc := servicioA(pool, ahora, nil)
	ctx := context.Background()

	ventaDelDia(t, pool, "CRC", "2026-10-01", 500)
	ventaDelDia(t, pool, "CRC", "2026-10-18", 560)
	movimientoEn(t, pool, userID, "sinpe_send", "CRC", 475_000_000, enCR(2026, time.October, 1, 0, 1))
	tx := movimientoEn(t, pool, userID, "sinpe_send", "USD", 60_000, ahora)
	svc.Report(ctx, userID, tx, "USD", 60_000)

	casos := casosDelUsuario(t, pool, userID)
	if len(casos) != 1 || casos[0].tipo != "multiples_mes" {
		t.Fatalf("casos = %+v, se esperaba uno multiples_mes con la venta de cada dia", casos)
	}
}

// capturarLog junta lo que el servicio escribe en el log mientras dura la
// prueba.
func capturarLog(t *testing.T) *bytes.Buffer {
	t.Helper()
	var buf bytes.Buffer
	antes := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&buf, &slog.HandlerOptions{Level: slog.LevelDebug})))
	t.Cleanup(func() { slog.SetDefault(antes) })
	return &buf
}

// Ninguna norma fija cuan vieja puede ser la tasa: se acepta la ultima
// publicada, y con mas de seis dias naturales se da la alarma sin bloquear. Un
// tipo de cambio de hace ocho dias compara igual (₡5.500.000 a 500 son
// US$11.000), queda registrado con su fecha y avisa.
func TestUIF_UnaTasaViejaSeUsaYAlarma(t *testing.T) {
	_, _, pool, userID := setupUIF(t)
	svc := uif.NewService(uif.NewRepository(pool), nil)
	ctx := context.Background()
	log := capturarLog(t)

	ahora := time.Now()
	hace8 := ahora.In(horaCR).AddDate(0, 0, -8)
	ventaDelDia(t, pool, "CRC", diaCR(hace8), 500)
	tx := movimientoEn(t, pool, userID, "sinpe_send", "CRC", 550_000_000, ahora)
	svc.Report(ctx, userID, tx, "CRC", 550_000_000)

	if n := contarCasos(t, pool, userID, uif.TypeManual); n != 0 {
		t.Fatalf("una tasa de hace ocho dias abrio %d casos manuales: se acepta la ultima publicada", n)
	}
	if n := len(casosDelUsuario(t, pool, userID)); n != 1 {
		t.Fatalf("casos = %d, se esperaba uno: US$11.000 superan el umbral", n)
	}
	var fecha string
	if err := pool.QueryRow(ctx,
		`SELECT tasa_fecha::text FROM uif_movimientos WHERE tx_id = $1::uuid`, tx).Scan(&fecha); err != nil {
		t.Fatalf("leer la fecha de la tasa: %v", err)
	}
	if fecha != diaCR(hace8) {
		t.Fatalf("fecha de la tasa = %s, se esperaba %s", fecha, diaCR(hace8))
	}
	if !strings.Contains(log.String(), "tipo de cambio viejo") {
		t.Fatalf("una tasa de ocho dias no dio la alarma; el log dice:\n%s", log.String())
	}
}

// Seis dias naturales todavia no son "mas de seis": no hay alarma.
func TestUIF_UnaTasaDeSeisDiasNoAlarma(t *testing.T) {
	_, _, pool, userID := setupUIF(t)
	svc := uif.NewService(uif.NewRepository(pool), nil)
	log := capturarLog(t)

	ahora := time.Now()
	ventaDelDia(t, pool, "CRC", diaCR(ahora.In(horaCR).AddDate(0, 0, -6)), 500)
	tx := movimientoEn(t, pool, userID, "sinpe_send", "CRC", 100_000, ahora)
	svc.Report(context.Background(), userID, tx, "CRC", 100_000)

	if strings.Contains(log.String(), "tipo de cambio viejo") {
		t.Fatalf("una tasa de seis dias dio la alarma:\n%s", log.String())
	}
	var n int
	if err := pool.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM uif_movimientos WHERE tx_id = $1::uuid AND usd_minor IS NOT NULL`, tx).Scan(&n); err != nil {
		t.Fatalf("leer el registro: %v", err)
	}
	if n != 1 {
		t.Fatal("el movimiento no quedo registrado con su equivalente")
	}
}

// El euro se dolariza con la cotizacion del euro que publica el BCCR (Hacienda
// la da en dolares por euro: 1,1252). €9.000 son US$10.126,80.
func TestUIF_ElEuroSeDolarizaConLaCotizacionDelBCCR(t *testing.T) {
	_, _, pool, userID := setupUIF(t)
	svc := uif.NewService(uif.NewRepository(pool), nil)
	ctx := context.Background()

	ahora := time.Now()
	ventaDelDia(t, pool, "EUR", diaCR(ahora), 1/1.1252)
	tx := movimientoEn(t, pool, userID, "sinpe_send", "EUR", 900_000, ahora)
	svc.Report(ctx, userID, tx, "EUR", 900_000)

	casos := casosDelUsuario(t, pool, userID)
	if len(casos) != 1 || casos[0].tipo == uif.TypeManual || casos[0].moneda != "EUR" {
		t.Fatalf("casos = %+v, se esperaba uno en EUR que no sea manual", casos)
	}
	var usd int64
	if err := pool.QueryRow(ctx,
		`SELECT usd_minor FROM uif_movimientos WHERE tx_id = $1::uuid`, tx).Scan(&usd); err != nil {
		t.Fatalf("leer el equivalente: %v", err)
	}
	if usd != 1_012_680 {
		t.Fatalf("€9.000 = %d centavos de dolar, se esperaba 1012680", usd)
	}
}
