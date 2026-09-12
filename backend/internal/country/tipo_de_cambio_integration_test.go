package country_test

import (
	"context"
	"errors"
	"testing"
	"time"

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
