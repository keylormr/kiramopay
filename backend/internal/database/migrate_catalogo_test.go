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

// exigirCatalogoConBorradoLogico revisa la 081 sobre el producto que sembro
// sembrarFechasSinZona, dentro de una transaccion que despues se deshace.
//
// El producto que ya estaba no queda sacado. La marca es con zona. Un producto
// sacado no puede quedar activo. Y la bajada se lleva la columna sin borrar
// ninguna fila.
func exigirCatalogoConBorradoLogico(ctx context.Context, t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	const comercio = "07500000-0000-4000-8000-0000000000c0"

	var tipo string
	if err := pool.QueryRow(ctx, `
		SELECT data_type FROM information_schema.columns
		 WHERE table_schema = 'public' AND table_name = 'merchant_catalog_items'
		   AND column_name = 'deleted_at'`).Scan(&tipo); err != nil {
		t.Fatalf("merchant_catalog_items.deleted_at no esta despues de la cadena: %v", err)
	}
	if tipo != "timestamp with time zone" {
		t.Errorf("merchant_catalog_items.deleted_at es %q, se esperaba con zona", tipo)
	}

	var producto string
	var sacado bool
	if err := pool.QueryRow(ctx, `
		SELECT id::text, deleted_at IS NOT NULL FROM merchant_catalog_items
		 WHERE merchant_id = $1::uuid AND name = 'Producto Zona'`, comercio,
	).Scan(&producto, &sacado); err != nil {
		t.Fatalf("leer el producto sembrado: %v", err)
	}
	if sacado {
		t.Error("la 081 dejo sacado un producto que ya estaba en el catalogo")
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("abrir la transaccion: %v", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	sp, err := tx.Begin(ctx)
	if err != nil {
		t.Fatalf("abrir el punto de guardado: %v", err)
	}
	_, err = sp.Exec(ctx, `UPDATE merchant_catalog_items SET deleted_at = NOW(), active = TRUE WHERE id = $1::uuid`, producto)
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) || pgErr.Code != "23514" {
		t.Errorf("sacado y activo: err = %v, se esperaba la violacion del CHECK (23514)", err)
	}
	if err := sp.Rollback(ctx); err != nil {
		t.Fatalf("volver al punto de guardado: %v", err)
	}

	if _, err := tx.Exec(ctx,
		`UPDATE merchant_catalog_items SET deleted_at = NOW(), active = FALSE WHERE id = $1::uuid`, producto); err != nil {
		t.Fatalf("sacar un producto tiene que entrar: %v", err)
	}

	cuerpo, err := os.ReadFile(filepath.Join(migracionesDir, "down", "081_catalogo_borrado_logico.down.sql"))
	if err != nil {
		t.Fatalf("leer la bajada de la 081: %v", err)
	}
	if _, err := tx.Exec(ctx, string(cuerpo)); err != nil {
		t.Fatalf("aplicar la bajada de la 081: %v", err)
	}
	var columnas, filas int
	if err := tx.QueryRow(ctx, `
		SELECT (SELECT COUNT(*) FROM information_schema.columns
		         WHERE table_schema = 'public' AND table_name = 'merchant_catalog_items'
		           AND column_name = 'deleted_at'),
		       (SELECT COUNT(*) FROM merchant_catalog_items WHERE id = $1::uuid AND NOT active)`, producto,
	).Scan(&columnas, &filas); err != nil {
		t.Fatalf("mirar despues de la bajada: %v", err)
	}
	if columnas != 0 {
		t.Error("despues de la bajada de la 081 sigue merchant_catalog_items.deleted_at")
	}
	if filas != 1 {
		t.Errorf("despues de la bajada de la 081 el producto sacado no esta, o volvio activo (filas inactivas: %d)", filas)
	}
}
