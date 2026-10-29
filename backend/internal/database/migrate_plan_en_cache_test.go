package database

import (
	"context"
	"testing"
	"time"

	"github.com/kiramopay/backend/internal/country"
)

// TestMigracionesNoDejanPlanesViejosEnElPool reproduce el arranque de una
// instalacion NUEVA tal como lo hace el servidor (RUN_MIGRATIONS=true): la
// cadena completa corre con RunMigrations y, a continuacion, el servidor usa el
// MISMO pool.
//
// El defecto que cubre: PL/pgSQL guarda, por conexion, el plan de cada funcion
// que ya ejecuto. La 043 siembra tipos de cambio y eso dispara
// fn_fx_close_active() (el trigger de exchange_rates) en la conexion de las
// migraciones; la 075 pasa effective_from y effective_to a TIMESTAMPTZ en esa
// misma sesion. Si esa conexion vuelve al pool, el primer INSERT en
// exchange_rates que le toque a ella —el que guarda el tipo de cambio de la
// fuente oficial— falla con
//
//	type of parameter 14 (timestamp with time zone) does not match that when
//	preparing the plan (timestamp without time zone)
//
// y la instalacion queda sin tipo de cambio. En produccion no se nota porque la
// 075 corrio en un arranque donde la 043 ya estaba aplicada desde hacia meses,
// en otra sesion. Pasa en una base nueva: recuperacion ante un desastre, un
// ambiente nuevo, el recorrido de CI.
//
// El pool es de UNA conexion para que el uso posterior caiga, sin azar, en la
// que corrio las migraciones.
func TestMigracionesNoDejanPlanesViejosEnElPool(t *testing.T) {
	pool, cleanup := baseDescartable(t, "kiramopay_plan_en_cache_test", 1)
	defer cleanup()

	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()

	if err := RunMigrations(ctx, pool, migracionesDir); err != nil {
		t.Fatalf("la cadena de migraciones: %v", err)
	}

	// Lo que usa fn_fx_close_active(): registrar el tipo de cambio de la fuente
	// oficial. La primera vez inserta (no hay nada que cerrar: la 088 saco la
	// semilla); la segunda, con otro valor, inserta y el trigger cierra la
	// anterior.
	repo := country.NewRepository(pool)
	for _, tasa := range []float64{510.5, 520.25} {
		if err := repo.RegistrarTipoDeCambio(ctx, "USD", "CRC", tasa, "bccr"); err != nil {
			t.Fatalf("registrar USD/CRC en %v por el pool con el que corrieron las migraciones: %v", tasa, err)
		}
	}

	var total, vigentes int
	var vigente float64
	if err := pool.QueryRow(ctx, `
		SELECT COUNT(*), COUNT(*) FILTER (WHERE effective_to IS NULL),
		       COALESCE(MAX(rate) FILTER (WHERE effective_to IS NULL), 0)::float8
		  FROM exchange_rates
		 WHERE from_currency = 'USD' AND to_currency = 'CRC'`).Scan(&total, &vigentes, &vigente); err != nil {
		t.Fatalf("leer el historial de USD/CRC: %v", err)
	}
	if total != 2 || vigentes != 1 || vigente != 520.25 {
		t.Errorf("USD/CRC tiene %d filas, %d vigentes, vigente %v: se esperaban 2, 1 y 520.25 (el trigger cierra la fila anterior)",
			total, vigentes, vigente)
	}
}
