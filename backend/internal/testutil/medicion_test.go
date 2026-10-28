package testutil

import (
	"context"
	"fmt"
	"sort"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Medicion del costo de TestDB. Imprime con -v; no afirma tiempos (un tope en
// segundos seria intermitente en un runner compartido).
//
//	go test ./internal/testutil/ -run TestMedirCostoDeTestDB -v -count=1

const repeticiones = 10

func medir(t *testing.T, nombre string, f func()) {
	t.Helper()
	ds := make([]time.Duration, 0, repeticiones)
	for i := 0; i < repeticiones; i++ {
		ini := time.Now()
		f()
		ds = append(ds, time.Since(ini))
	}
	informar(t, nombre, ds)
}

func informar(t *testing.T, nombre string, ds []time.Duration) {
	t.Helper()
	sort.Slice(ds, func(i, j int) bool { return ds[i] < ds[j] })
	var suma time.Duration
	for _, d := range ds {
		suma += d
	}
	t.Logf("MEDICION %-52s mediana=%-10v media=%-10v min=%-10v max=%-10v n=%d",
		nombre, ds[len(ds)/2].Round(time.Millisecond), (suma / time.Duration(len(ds))).Round(time.Millisecond),
		ds[0].Round(time.Millisecond), ds[len(ds)-1].Round(time.Millisecond), len(ds))
}

// todasLasTablas devuelve las tablas del esquema public, para truncarlas en una
// sola sentencia.
func todasLasTablas(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	var lista string
	if err := pool.QueryRow(context.Background(),
		`SELECT string_agg(format('%I', tablename), ', ') FROM pg_tables WHERE schemaname = 'public'`,
	).Scan(&lista); err != nil {
		t.Fatalf("listar tablas: %v", err)
	}
	return lista
}

func TestMedirCostoDeTestDB(t *testing.T) {
	ctx := context.Background()
	pool := TestDB(t)

	var tablas, indices int
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM pg_tables WHERE schemaname = 'public'`).Scan(&tablas)
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM pg_indexes WHERE schemaname = 'public'`).Scan(&indices)
	t.Logf("MEDICION esquema: %d tablas, %d indices", tablas, indices)

	medir(t, "createSchema (esquema ya creado)", func() {
		if err := createSchema(ctx, pool); err != nil {
			t.Fatalf("createSchema: %v", err)
		}
	})
	medir(t, "truncateAll (TRUNCATE de a una tabla, vacias)", func() {
		if err := truncateAll(ctx, pool); err != nil {
			t.Fatalf("truncateAll: %v", err)
		}
	})
	todas := todasLasTablas(t, pool)
	medir(t, "un solo TRUNCATE de todas las tablas, vacias", func() {
		if _, err := pool.Exec(ctx, "TRUNCATE TABLE "+todas+" CASCADE"); err != nil {
			t.Fatalf("truncate: %v", err)
		}
	})
	if err := truncateAll(ctx, pool); err != nil { // deja el sembrado de ledger_accounts
		t.Fatalf("truncateAll: %v", err)
	}
	medir(t, "SELECT 1 (ida y vuelta a la base)", func() {
		var x int
		if err := pool.QueryRow(ctx, `SELECT 1`).Scan(&x); err != nil {
			t.Fatalf("select: %v", err)
		}
	})
	medir(t, "abrir un pool nuevo + ping (lo que hace TestDB)", func() {
		cfg := configDePrueba(t)
		p, err := pgxpool.NewWithConfig(ctx, cfg)
		if err != nil {
			t.Fatalf("pool: %v", err)
		}
		defer p.Close()
		if err := p.Ping(ctx); err != nil {
			t.Fatalf("ping: %v", err)
		}
	})

	// Lo que ve cada prueba: el arranque de TestDB y su cierre.
	arranques := make([]time.Duration, 0, repeticiones)
	cierres := make([]time.Duration, 0, repeticiones)
	for i := 0; i < repeticiones; i++ {
		var arranque time.Duration
		ini := time.Now()
		t.Run(fmt.Sprintf("it%d", i), func(t *testing.T) {
			a := time.Now()
			_ = TestDB(t)
			arranque = time.Since(a)
		})
		arranques = append(arranques, arranque)
		cierres = append(cierres, time.Since(ini)-arranque)
	}
	informar(t, "TestDB: arranque (lo que espera cada prueba)", arranques)
	informar(t, "TestDB: cierre (limpieza al terminar)", cierres)
}
