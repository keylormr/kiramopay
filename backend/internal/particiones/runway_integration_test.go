package particiones_test

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/kiramopay/backend/internal/testutil"
)

// transactions_partition_runway() responde hasta que fecha hay cobertura, y esa
// respuesta es la que /health publica y la que alguien va a usar para decidir si
// hay que actuar. Lo sutil es que tiene que CORTARSE EN EL PRIMER HUECO: dos
// bloques de particiones separados por un mes vacio no son cobertura, y devolver
// el maximo absoluto seria informar un margen que no existe — justo el tipo de
// numero tranquilizador y falso que esta jornada estuvo persiguiendo.
//
// La prueba ejecuta la MIGRACION DE VERDAD, no una copia: si alguien cambia el
// SQL, esto lo prueba. La funcion solo mira pg_class.relname, asi que unas tablas
// vacias con el nombre correcto bastan para ejercitarla sin tener que convertir
// `transactions` en particionada dentro del esquema compartido de pruebas.
func TestRunwayCortaEnElPrimerHueco(t *testing.T) {
	pool := testutil.TestDB(t)
	ctx := context.Background()

	sql, err := os.ReadFile("../../migrations/061_particiones_con_margen.sql")
	if err != nil {
		t.Fatalf("leer la migracion: %v", err)
	}
	// La ultima linea llama a maintain_all_partitions(), que vive en la
	// migracion 023 y no existe en el esquema de pruebas. Se ejecutan solo las
	// definiciones de funcion, que es lo que esta prueba ejercita.
	corte := strings.Index(string(sql), "SELECT maintain_all_partitions();")
	if corte < 0 {
		t.Fatal("la migracion ya no llama a maintain_all_partitions: revisar esta prueba")
	}
	if _, err := pool.Exec(ctx, string(sql)[:corte]); err != nil {
		t.Fatalf("aplicar las funciones de la migracion: %v", err)
	}

	// El mes de referencia se pide A LA BASE, no al reloj de Go: la funcion usa
	// CURRENT_DATE, y cerca de medianoche los dos relojes pueden estar en meses
	// distintos. Ademas se normaliza al dia 1 antes de sumar meses, porque
	// sumar un mes al 31 de agosto da 1 de octubre y se saltaria septiembre.
	var base time.Time
	if err := pool.QueryRow(ctx, `SELECT date_trunc('month', CURRENT_DATE)::date`).Scan(&base); err != nil {
		t.Fatalf("mes de referencia: %v", err)
	}
	inicioDeMes := func(delta int) time.Time { return base.AddDate(0, delta, 0) }

	creadas := []string{}
	t.Cleanup(func() {
		for _, n := range creadas {
			_, _ = pool.Exec(context.Background(), `DROP TABLE IF EXISTS `+n)
		}
	})
	crear := func(delta int) {
		n := "transactions_" + inicioDeMes(delta).Format("2006_01")
		if _, err := pool.Exec(ctx, `CREATE TABLE IF NOT EXISTS `+n+` (x int)`); err != nil {
			t.Fatalf("crear %s: %v", n, err)
		}
		creadas = append(creadas, n)
	}

	leerMargen := func() time.Time {
		var d time.Time
		if err := pool.QueryRow(ctx, `SELECT transactions_partition_runway()`).Scan(&d); err != nil {
			t.Fatalf("transactions_partition_runway: %v", err)
		}
		return d
	}

	// Sin ninguna particion del mes en curso: cobertura cero, o sea el propio
	// mes actual. Es el caso "esto ya se rompio".
	if got := leerMargen(); !got.Equal(inicioDeMes(0)) {
		t.Fatalf("sin particiones el margen deberia ser el mes actual (%s), fue %s",
			inicioDeMes(0).Format("2006-01-02"), got.Format("2006-01-02"))
	}

	// Tres meses seguidos, y despues un HUECO, y despues dos meses mas.
	crear(0)
	crear(1)
	crear(2)
	// (mes 3 a proposito NO se crea)
	crear(4)
	crear(5)

	got := leerMargen()
	quiero := inicioDeMes(3)
	if !got.Equal(quiero) {
		t.Fatalf("el margen tiene que cortarse en el hueco: esperaba %s, fue %s.\n"+
			"Contar hasta la ultima particion existente informaria un margen que no existe.",
			quiero.Format("2006-01-02"), got.Format("2006-01-02"))
	}

	// Tapado el hueco, la cobertura se extiende hasta el final del segundo bloque.
	crear(3)
	got = leerMargen()
	quiero = inicioDeMes(6)
	if !got.Equal(quiero) {
		t.Fatalf("tapado el hueco esperaba %s, fue %s", quiero.Format("2006-01-02"), got.Format("2006-01-02"))
	}
}
