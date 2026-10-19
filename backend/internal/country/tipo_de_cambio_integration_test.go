package country_test

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/kiramopay/backend/internal/country"
	"github.com/kiramopay/backend/internal/testutil"
)

// El tipo de cambio estuvo congelado en 515 mientras el oficial bajaba a 450:
// cada compra o venta de cripto en colones se cotizaba con un 14 % de desvio.

type fuente struct {
	c   *country.Cotizacion
	err error
}

func (f *fuente) Obtener(context.Context) (*country.Cotizacion, error) { return f.c, f.err }

func hoy() time.Time {
	n := time.Now().UTC()
	return time.Date(n.Year(), n.Month(), n.Day(), 0, 0, 0, 0, time.UTC)
}

// sembrarTasaVieja deja el par como lo dejo la migracion 043: 515, manual, y
// sin que nadie lo haya confirmado en meses.
func sembrarTasaVieja(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	if _, err := pool.Exec(context.Background(), `
		INSERT INTO exchange_rates (from_currency, to_currency, rate, source, updated_at, effective_from)
		VALUES ('USD','CRC',515,'manual', NOW() - INTERVAL '90 days', NOW() - INTERVAL '90 days'),
		       ('CRC','USD',0.00194,'manual', NOW() - INTERVAL '90 days', NOW() - INTERVAL '90 days')`); err != nil {
		t.Fatalf("sembrar tasa vieja: %v", err)
	}
}

func filasDelPar(t *testing.T, pool *pgxpool.Pool, desde, hacia string) (total, vigentes int) {
	t.Helper()
	if err := pool.QueryRow(context.Background(), `
		SELECT COUNT(*), COUNT(*) FILTER (WHERE effective_to IS NULL)
		  FROM exchange_rates WHERE from_currency = $1 AND to_currency = $2`,
		desde, hacia).Scan(&total, &vigentes); err != nil {
		t.Fatalf("contar filas: %v", err)
	}
	return total, vigentes
}

// Una tasa que nadie confirma hace meses no puede cobrar.
func TestLaTasaCongeladaNoCobra(t *testing.T) {
	pool := testutil.TestDB(t)
	repo := country.NewRepository(pool)
	sembrarTasaVieja(t, pool)

	_, err := repo.TipoDeCambioParaCobrar(context.Background(), "USD", "CRC")
	if !errors.Is(err, country.ErrTipoDeCambioViejo) {
		t.Fatalf("err = %v, se esperaba ErrTipoDeCambioViejo", err)
	}
}

func TestElActualizadorTraeLaTasaOficialYGuardaLaHistoria(t *testing.T) {
	pool := testutil.TestDB(t)
	repo := country.NewRepository(pool)
	ctx := context.Background()
	sembrarTasaVieja(t, pool)

	f := &fuente{c: &country.Cotizacion{Compra: 444.22, Venta: 450.06, Fecha: hoy()}}
	a := country.NewActualizador(repo, f, time.Hour, nil)
	if err := a.ActualizarUnaVez(ctx); err != nil {
		t.Fatalf("ActualizarUnaVez: %v", err)
	}

	tasa, err := repo.TipoDeCambioParaCobrar(ctx, "USD", "CRC")
	if err != nil {
		t.Fatalf("TipoDeCambioParaCobrar: %v", err)
	}
	if tasa != 450.06 {
		t.Fatalf("USD/CRC = %v, se esperaba 450.06", tasa)
	}
	// El inverso es el mismo numero: una vuelta USD -> CRC -> USD no crea plata.
	inverso, err := repo.TipoDeCambioParaCobrar(ctx, "CRC", "USD")
	if err != nil {
		t.Fatalf("CRC/USD: %v", err)
	}
	if vuelta := 450.06 * inverso; vuelta < 0.999999 || vuelta > 1.000001 {
		t.Fatalf("USD -> CRC -> USD = %v, se esperaba 1", vuelta)
	}

	// La 515 NO se borra: queda cerrada como historia, y hay una sola vigente.
	total, vigentes := filasDelPar(t, pool, "USD", "CRC")
	if total != 2 || vigentes != 1 {
		t.Fatalf("USD/CRC: %d filas, %d vigentes; se esperaba 2 y 1", total, vigentes)
	}

	// El diagnostico de /health dice lo que se guardo.
	if d := a.Diagnostico(); d.UsdCrc != 450.06 || d.UltimaConfirmacion == nil || d.UltimoError != "" {
		t.Fatalf("diagnostico = %+v", d)
	}
}

// La fuente confirma cada hora; si el dolar no se movio, no se llena el
// historial de filas repetidas, pero la confirmacion SI queda anotada.
func TestUnaTasaQueNoCambioSoloSeConfirma(t *testing.T) {
	pool := testutil.TestDB(t)
	repo := country.NewRepository(pool)
	ctx := context.Background()

	f := &fuente{c: &country.Cotizacion{Compra: 444.22, Venta: 450.06, Fecha: hoy()}}
	a := country.NewActualizador(repo, f, time.Hour, nil)
	if err := a.ActualizarUnaVez(ctx); err != nil {
		t.Fatalf("primera: %v", err)
	}
	// Envejecer la confirmacion a mano, como si hubieran pasado cinco dias.
	if _, err := pool.Exec(ctx, `UPDATE exchange_rates SET updated_at = NOW() - INTERVAL '5 days'`); err != nil {
		t.Fatalf("envejecer: %v", err)
	}
	if _, err := repo.TipoDeCambioParaCobrar(ctx, "USD", "CRC"); !errors.Is(err, country.ErrTipoDeCambioViejo) {
		t.Fatalf("tras cinco dias sin confirmar: err = %v, se esperaba ErrTipoDeCambioViejo", err)
	}

	if err := a.ActualizarUnaVez(ctx); err != nil {
		t.Fatalf("segunda: %v", err)
	}
	if total, _ := filasDelPar(t, pool, "USD", "CRC"); total != 1 {
		t.Fatalf("filas = %d, se esperaba 1: la misma tasa no es una fila nueva", total)
	}
	if _, err := repo.TipoDeCambioParaCobrar(ctx, "USD", "CRC"); err != nil {
		t.Fatalf("tras reconfirmar: %v", err)
	}

	// Y un movimiento real si deja historia.
	f.c = &country.Cotizacion{Compra: 446.10, Venta: 452.30, Fecha: hoy()}
	if err := a.ActualizarUnaVez(ctx); err != nil {
		t.Fatalf("tercera: %v", err)
	}
	total, vigentes := filasDelPar(t, pool, "USD", "CRC")
	if total != 2 || vigentes != 1 {
		t.Fatalf("tras moverse: %d filas, %d vigentes; se esperaba 2 y 1", total, vigentes)
	}
	if tasa, _ := repo.TipoDeCambioParaCobrar(ctx, "USD", "CRC"); tasa != 452.30 {
		t.Fatalf("USD/CRC = %v, se esperaba 452.30", tasa)
	}
}

// Una fuente caida no toca la tasa vigente ni la reemplaza por nada.
func TestUnaFuenteCaidaNoTocaLaTasa(t *testing.T) {
	pool := testutil.TestDB(t)
	repo := country.NewRepository(pool)
	ctx := context.Background()

	f := &fuente{c: &country.Cotizacion{Compra: 444.22, Venta: 450.06, Fecha: hoy()}}
	a := country.NewActualizador(repo, f, time.Hour, nil)
	if err := a.ActualizarUnaVez(ctx); err != nil {
		t.Fatalf("primera: %v", err)
	}

	f.c, f.err = nil, errors.New("hacienda: HTTP 503")
	if err := a.ActualizarUnaVez(ctx); err == nil {
		t.Fatal("una fuente caida tiene que devolver error")
	}
	if tasa, err := repo.TipoDeCambioParaCobrar(ctx, "USD", "CRC"); err != nil || tasa != 450.06 {
		t.Fatalf("tras la caida: tasa=%v err=%v; se esperaba 450.06 intacta", tasa, err)
	}

	// Y una cotizacion absurda tampoco entra.
	f.c, f.err = &country.Cotizacion{Compra: 44422, Venta: 45006, Fecha: hoy()}, nil
	if err := a.ActualizarUnaVez(ctx); err == nil {
		t.Fatal("una cotizacion fuera de rango tiene que rechazarse")
	}
	if tasa, _ := repo.TipoDeCambioParaCobrar(ctx, "USD", "CRC"); tasa != 450.06 {
		t.Fatalf("tras la basura: tasa = %v, se esperaba 450.06 intacta", tasa)
	}
}

// La UIF necesita la venta de referencia de CADA DIA, con la fecha que le pone
// el BCCR: el total del mes se convierte con la del ultimo dia del mes, y cada
// movimiento con la de su dia. exchange_rates solo guarda una fila cuando la
// tasa cambia y con la hora en que se trajo, no la fecha de publicacion.

func ventaGuardada(t *testing.T, pool *pgxpool.Pool, moneda, fecha string) (float64, string, bool) {
	t.Helper()
	var porDolar float64
	var fuente string
	err := pool.QueryRow(context.Background(), `
		SELECT por_dolar::float8, fuente FROM tipo_de_cambio_diario
		 WHERE moneda = $1 AND fecha = $2::date`, moneda, fecha).Scan(&porDolar, &fuente)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, "", false
	}
	if err != nil {
		t.Fatalf("leer la venta de %s del %s: %v", moneda, fecha, err)
	}
	return porDolar, fuente, true
}

func TestElActualizadorGuardaLaVentaDelDia(t *testing.T) {
	pool := testutil.TestDB(t)
	repo := country.NewRepository(pool)
	ctx := context.Background()

	f := &fuente{c: &country.Cotizacion{Compra: 444.22, Venta: 450.06, Fecha: hoy()}}
	if err := country.NewActualizador(repo, f, time.Hour, nil).ActualizarUnaVez(ctx); err != nil {
		t.Fatalf("ActualizarUnaVez: %v", err)
	}
	venta, origen, ok := ventaGuardada(t, pool, "CRC", hoy().Format(time.DateOnly))
	if !ok || venta != 450.06 || origen != "hacienda" {
		t.Fatalf("venta del dia: %v (%s, guardada %v); se esperaba 450.06 de hacienda", venta, origen, ok)
	}
}

// fuenteConEuro tambien publica la cotizacion del euro, en dolares por euro y
// con su propia fecha: el BCCR no la publica los fines de semana.
type fuenteConEuro struct {
	fuente
	dolaresPorEuro float64
	fechaEuro      time.Time
	errEuro        error
}

func (f *fuenteConEuro) ObtenerEuro(context.Context) (float64, time.Time, error) {
	return f.dolaresPorEuro, f.fechaEuro, f.errEuro
}

func TestElActualizadorGuardaElEuroDelBCCR(t *testing.T) {
	pool := testutil.TestDB(t)
	repo := country.NewRepository(pool)
	ctx := context.Background()

	viernes := hoy().AddDate(0, 0, -2)
	f := &fuenteConEuro{
		fuente:         fuente{c: &country.Cotizacion{Compra: 444.22, Venta: 450.06, Fecha: hoy()}},
		dolaresPorEuro: 1.1252, fechaEuro: viernes,
	}
	if err := country.NewActualizador(repo, f, time.Hour, nil).ActualizarUnaVez(ctx); err != nil {
		t.Fatalf("ActualizarUnaVez: %v", err)
	}
	// Se guarda como todo lo demas: cuantos euros vale un dolar.
	porDolar, _, ok := ventaGuardada(t, pool, "EUR", viernes.Format(time.DateOnly))
	if !ok || porDolar < 0.88873 || porDolar > 0.88874 {
		t.Fatalf("euro del %s: %v (guardado %v); se esperaba 1/1,1252 = 0,88873", viernes.Format(time.DateOnly), porDolar, ok)
	}
}

// Si la cotizacion del euro falla, el dolar se actualiza igual: el euro no
// puede dejar a la aplicacion sin el tipo de cambio con el que cobra.
func TestSinEuroElDolarSeActualizaIgual(t *testing.T) {
	pool := testutil.TestDB(t)
	repo := country.NewRepository(pool)
	ctx := context.Background()

	f := &fuenteConEuro{
		fuente:  fuente{c: &country.Cotizacion{Compra: 444.22, Venta: 450.06, Fecha: hoy()}},
		errEuro: errors.New("hacienda: HTTP 503"),
	}
	if err := country.NewActualizador(repo, f, time.Hour, nil).ActualizarUnaVez(ctx); err != nil {
		t.Fatalf("ActualizarUnaVez fallo por el euro: %v", err)
	}
	if tasa, err := repo.TipoDeCambioParaCobrar(ctx, "USD", "CRC"); err != nil || tasa != 450.06 {
		t.Fatalf("USD/CRC = %v (%v), se esperaba 450.06", tasa, err)
	}
	if _, _, ok := ventaGuardada(t, pool, "CRC", hoy().Format(time.DateOnly)); !ok {
		t.Fatal("sin euro no se guardo la venta del dolar del dia")
	}
}

// Si no se puede guardar la venta del dia (la tabla no esta, la base fallo), el
// dolar con que se cobra igual queda actualizado, el diagnostico lo muestra y
// dice que fallo.
func TestSinLaVentaDelDiaElDolarSeActualizaIgual(t *testing.T) {
	pool := testutil.TestDB(t)
	repo := country.NewRepository(pool)
	ctx := context.Background()
	if _, err := pool.Exec(ctx, `ALTER TABLE tipo_de_cambio_diario RENAME TO tipo_de_cambio_diario_escondida`); err != nil {
		t.Fatalf("esconder la tabla: %v", err)
	}
	t.Cleanup(func() {
		if _, err := pool.Exec(context.Background(),
			`ALTER TABLE IF EXISTS tipo_de_cambio_diario_escondida RENAME TO tipo_de_cambio_diario`); err != nil {
			t.Fatalf("devolver la tabla: %v", err)
		}
	})

	f := &fuente{c: &country.Cotizacion{Compra: 444.22, Venta: 450.06, Fecha: hoy()}}
	a := country.NewActualizador(repo, f, time.Hour, nil)
	if err := a.ActualizarUnaVez(ctx); err != nil {
		t.Fatalf("ActualizarUnaVez: %v", err)
	}
	if tasa, err := repo.TipoDeCambioParaCobrar(ctx, "USD", "CRC"); err != nil || tasa != 450.06 {
		t.Fatalf("USD/CRC = %v (%v), se esperaba 450.06", tasa, err)
	}
	if d := a.Diagnostico(); d.UsdCrc != 450.06 || !strings.Contains(d.UltimoError, "venta del dia") {
		t.Fatalf("diagnostico = %+v: tiene que mostrar el dolar y decir que fallo la venta del dia", d)
	}
}
