package database

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// TestRunAllMigrations applies every migration file, in order, against the DB
// pointed to by MIGTEST_DSN — the same code path the backend runs on deploy
// (RUN_MIGRATIONS=true). It validates that the full chain applies cleanly,
// which is the deploy gate for the database layer.
//
// The target DB must have the `kiramopay.encryption_key` GUC set (migration 024
// requires it), mirroring the production prerequisite.
func TestRunAllMigrations(t *testing.T) {
	dsn := os.Getenv("MIGTEST_DSN")
	if dsn == "" {
		t.Skip("set MIGTEST_DSN to run the full migration-chain validation")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer pool.Close()

	if err := RunMigrations(ctx, pool, "../../migrations"); err != nil {
		t.Fatalf("migration chain failed: %v", err)
	}

	// Re-running must be a clean no-op (idempotent applied-tracking).
	if err := RunMigrations(ctx, pool, "../../migrations"); err != nil {
		t.Fatalf("second migration run not idempotent: %v", err)
	}

	exigirFechasConZona(ctx, t, pool)
}

// sinZonaConocidas son las columnas que siguen siendo timestamp sin zona al
// final de la cadena. La 034 convirtio todas las que habia, salvo las que usaba
// una vista (Postgres no cambia el tipo de una columna que una vista lee), y
// despues de la 034 tres migraciones volvieron a crear columnas sin zona. Son
// deuda: convertirlas es una migracion propia. Lo que esta lista cuida es que
// no se sumen otras.
var sinZonaConocidas = map[string]bool{
	"exchange_rates.effective_from":      true, // 021, la lee la vista current_exchange_rates
	"exchange_rates.effective_to":        true, // 021, idem
	"users.created_at":                   true, // 001, la lee la vista users_masked
	"users.updated_at":                   true, // 001, idem
	"users.last_login_at":                true, // 001, idem
	"users.kyc_verified_at":              true, // 001, idem
	"users.deleted_at":                   true, // 001, idem
	"merchant_locations.created_at":      true, // 046
	"merchant_staff.created_at":          true, // 046
	"merchant_staff.revoked_at":          true, // 046
	"merchant_catalog_items.created_at":  true, // 046
	"assistant_conversations.created_at": true, // 049
	"assistant_conversations.updated_at": true, // 049
	"user_totp.disabled_at":              true, // 055
	"totp_recovery_codes.invalidated_at": true, // 055
}

// exigirFechasConZona falla si al final de la cadena hay una columna timestamp
// sin zona que no este en sinZonaConocidas, o si una de la lista ya no lo es (y
// entonces sobra en ella). Un timestamp sin zona escrito con NOW() guarda la
// hora local del servidor y la aplicacion la lee como UTC (ver la 034). Las
// pruebas de integracion no lo ven: su esquema convierte todo a timestamptz.
func exigirFechasConZona(ctx context.Context, t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	filas, err := pool.Query(ctx, `
		SELECT c.relname || '.' || a.attname
		FROM pg_attribute a
		JOIN pg_class c ON c.oid = a.attrelid
		JOIN pg_namespace n ON n.oid = c.relnamespace
		WHERE n.nspname = 'public'
		  AND c.relkind IN ('r', 'p')
		  AND NOT c.relispartition
		  AND a.attnum > 0
		  AND NOT a.attisdropped
		  AND a.atttypid = 'timestamp'::regtype
		ORDER BY 1`)
	if err != nil {
		t.Fatalf("leer las columnas sin zona: %v", err)
	}
	columnas, err := pgx.CollectRows(filas, pgx.RowTo[string])
	if err != nil {
		t.Fatalf("leer las columnas sin zona: %v", err)
	}
	sinZona := make(map[string]bool, len(columnas))
	for _, col := range columnas {
		sinZona[col] = true
		if !sinZonaConocidas[col] {
			t.Errorf("%s es timestamp sin zona: tiene que ser TIMESTAMPTZ", col)
		}
	}
	for col := range sinZonaConocidas {
		if !sinZona[col] {
			t.Errorf("%s ya tiene zona: sacarla de sinZonaConocidas", col)
		}
	}
}
