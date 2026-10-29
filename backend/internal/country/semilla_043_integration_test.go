package country_test

import (
	"context"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kiramopay/backend/internal/country"
	"github.com/kiramopay/backend/internal/testutil"
)

// La migracion 043 sembraba USD/CRC en 515, y los pares del colon que se
// derivan de ese numero (el dolar al reves y el balboa, atado 1:1 al dolar),
// con fuente 'manual'. En una base nueva eso dejaba un tipo de cambio
// inventado como si fuera vigente hasta la primera consulta a la fuente
// oficial: con el reloj de 96 horas contando desde la migracion, cripto en
// colones se cotizaba con un 515 que nadie confirmo. La 088 lo saca.
//
// Las tasas del quetzal NO se tocan: son manuales y no tienen otra fuente.

func correrMigracion(t *testing.T, pool *pgxpool.Pool, archivo string) {
	t.Helper()
	sql, err := os.ReadFile("../../migrations/" + archivo)
	if err != nil {
		t.Fatalf("leer %s: %v", archivo, err)
	}
	if _, err := pool.Exec(context.Background(), string(sql)); err != nil {
		t.Fatalf("correr %s: %v", archivo, err)
	}
}

func vigentes(t *testing.T, pool *pgxpool.Pool) map[string]float64 {
	t.Helper()
	filas, err := pool.Query(context.Background(),
		`SELECT from_currency || '/' || to_currency, rate::float8
		   FROM exchange_rates WHERE effective_to IS NULL`)
	if err != nil {
		t.Fatalf("leer las tasas vigentes: %v", err)
	}
	defer filas.Close()
	out := map[string]float64{}
	for filas.Next() {
		var par string
		var tasa float64
		if err := filas.Scan(&par, &tasa); err != nil {
			t.Fatalf("leer una tasa: %v", err)
		}
		out[par] = tasa
	}
	return out
}

var paresDelColon = []string{"USD/CRC", "CRC/USD", "PAB/CRC", "CRC/PAB"}

var paresIntactos = []string{
	"USD/PAB", "PAB/USD",
	"USD/GTQ", "GTQ/USD", "CRC/GTQ", "GTQ/CRC", "PAB/GTQ", "GTQ/PAB",
}

// En una base nueva: tras la 043 estan los doce pares; tras la 088 no queda
// ningun tipo de cambio del colon inventado y todo lo demas sigue igual.
func TestMigracion088_UnaBaseNuevaNoTieneUn515Inventado(t *testing.T) {
	pool := testutil.TestDB(t)

	correrMigracion(t, pool, "043_seed_exchange_rates.sql")
	antes := vigentes(t, pool)
	for _, par := range paresDelColon {
		if _, hay := antes[par]; !hay {
			t.Fatalf("la 043 no sembro %s: la prueba no ejercita el caso", par)
		}
	}

	correrMigracion(t, pool, "088_sin_tipo_de_cambio_inventado.sql")
	despues := vigentes(t, pool)

	for _, par := range paresDelColon {
		if tasa, hay := despues[par]; hay {
			t.Errorf("%s sigue vigente con %v: una base nueva no debe traer un tipo de cambio del colon inventado", par, tasa)
		}
	}
	for _, par := range paresIntactos {
		if despues[par] != antes[par] || antes[par] == 0 {
			t.Errorf("%s = %v despues de la 088, era %v: no se toca", par, despues[par], antes[par])
		}
	}
}

// Donde la fuente oficial ya escribio el tipo de cambio, la 088 no hace nada:
// ni toca la tasa vigente ni borra la historia.
func TestMigracion088_NoTocaLoQueLaFuenteOficialYaEscribio(t *testing.T) {
	pool := testutil.TestDB(t)
	ctx := context.Background()
	repo := country.NewRepository(pool)

	correrMigracion(t, pool, "043_seed_exchange_rates.sql")
	if err := repo.RegistrarTipoDeCambio(ctx, "USD", "CRC", 455.21, "bccr"); err != nil {
		t.Fatalf("registrar el dolar: %v", err)
	}
	if err := repo.RegistrarTipoDeCambio(ctx, "CRC", "USD", 1/455.21, "bccr"); err != nil {
		t.Fatalf("registrar el colon: %v", err)
	}

	correrMigracion(t, pool, "088_sin_tipo_de_cambio_inventado.sql")

	if v := vigentes(t, pool)["USD/CRC"]; v != 455.21 {
		t.Errorf("USD/CRC vigente = %v, se esperaba 455.21", v)
	}
	total, vigente := filasDelPar(t, pool, "USD", "CRC")
	if total != 2 || vigente != 1 {
		t.Errorf("filas de USD/CRC = %d (%d vigentes), se esperaban 2 con 1 vigente: la historia se conserva", total, vigente)
	}
}

// Un tipo de cambio manual que una persona fijo a mano (520, no el 515 de la
// semilla) es una decision y no se borra.
func TestMigracion088_NoBorraUnaTasaFijadaAMano(t *testing.T) {
	pool := testutil.TestDB(t)
	if _, err := pool.Exec(context.Background(), `
		INSERT INTO exchange_rates (from_currency, to_currency, rate, source)
		VALUES ('USD','CRC',520,'manual')`); err != nil {
		t.Fatalf("sembrar: %v", err)
	}

	correrMigracion(t, pool, "088_sin_tipo_de_cambio_inventado.sql")

	if v := vigentes(t, pool)["USD/CRC"]; v != 520 {
		t.Errorf("USD/CRC vigente = %v, se esperaba 520: una tasa fijada a mano no es la semilla", v)
	}
}
