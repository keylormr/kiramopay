package database

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// exigirCierreDeComercios revisa la 079 sobre el comercio que sembro
// sembrarFechasSinZona, dentro de una transaccion que despues se deshace.
//
// Un cierre a medias no puede quedar escrito: cerrado y activo, cerrado sin
// motivo o sin quien lo cerro, o un motivo sin cierre. Y la bajada se lleva las
// tres columnas.
func exigirCierreDeComercios(ctx context.Context, t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	const comercio = "07500000-0000-4000-8000-0000000000c0"
	const persona = "07500000-0000-4000-8000-000000000075"

	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("abrir la transaccion: %v", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	incoherentes := []struct{ que, set string }{
		{"cerrado y activo", `active = TRUE, closed_at = NOW(), closed_by = '` + persona + `', closure_reason = 'x'`},
		{"cerrado con active nulo", `active = NULL, closed_at = NOW(), closed_by = '` + persona + `', closure_reason = 'x'`},
		{"cerrado sin motivo", `active = FALSE, closed_at = NOW(), closed_by = '` + persona + `', closure_reason = NULL`},
		{"cerrado con el motivo en blanco", `active = FALSE, closed_at = NOW(), closed_by = '` + persona + `', closure_reason = '   '`},
		{"cerrado sin quien", `active = FALSE, closed_at = NOW(), closed_by = NULL, closure_reason = 'x'`},
		{"motivo sin cierre", `closure_reason = 'x'`},
		{"quien sin cierre", `closed_by = '` + persona + `'`},
	}
	for _, c := range incoherentes {
		sp, err := tx.Begin(ctx)
		if err != nil {
			t.Fatalf("abrir el punto de guardado: %v", err)
		}
		_, err = sp.Exec(ctx, `UPDATE qr_merchants SET `+c.set+` WHERE id = $1::uuid`, comercio)
		var pgErr *pgconn.PgError
		if !errors.As(err, &pgErr) || pgErr.Code != "23514" {
			t.Errorf("%s: err = %v, se esperaba la violacion del CHECK (23514)", c.que, err)
		}
		if err := sp.Rollback(ctx); err != nil {
			t.Fatalf("volver al punto de guardado: %v", err)
		}
	}

	if _, err := tx.Exec(ctx, `
		UPDATE qr_merchants
		   SET active = FALSE, closed_at = NOW(), closed_by = $2::uuid, closure_reason = 'prueba'
		 WHERE id = $1::uuid`, comercio, persona); err != nil {
		t.Fatalf("un cierre completo tiene que entrar: %v", err)
	}

	cuerpo, err := os.ReadFile(filepath.Join(migracionesDir, "down", "079_cierre_de_comercios.down.sql"))
	if err != nil {
		t.Fatalf("leer la bajada de la 079: %v", err)
	}
	if _, err := tx.Exec(ctx, string(cuerpo)); err != nil {
		t.Fatalf("aplicar la bajada de la 079: %v", err)
	}
	var quedan int
	if err := tx.QueryRow(ctx, `
		SELECT COUNT(*) FROM information_schema.columns
		 WHERE table_schema = 'public' AND table_name = 'qr_merchants'
		   AND column_name IN ('closed_at', 'closed_by', 'closure_reason')`).Scan(&quedan); err != nil {
		t.Fatalf("mirar las columnas: %v", err)
	}
	if quedan != 0 {
		t.Errorf("despues de la bajada de la 079 quedan %d columnas del cierre", quedan)
	}
}
