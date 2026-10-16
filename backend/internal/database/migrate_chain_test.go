package database

import (
	"context"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

const migracionesDir = "../../migrations"

// TestRunAllMigrations applies every migration file, in order, against the DB
// pointed to by MIGTEST_DSN — the same code path the backend runs on deploy
// (RUN_MIGRATIONS=true). It validates that the full chain applies cleanly,
// which is the deploy gate for the database layer.
//
// La cadena corre en dos tramos: hasta la 074, con fechas sin zona conocidas
// sembradas al final (sembrarFechasSinZona), y desde la 075 con la sesion en
// una zona que no es UTC (zonaFueraDeUTC). Asi se ve que la 075 conserva el
// instante de lo que ya habia guardado.
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

	// Sobre una base ya migrada la siembra caeria despues de la 075 y la prueba
	// de la conversion pasaria sin haberla visto.
	var yaMigrada bool
	if err := pool.QueryRow(ctx, `SELECT to_regclass('public.schema_migrations') IS NOT NULL`).Scan(&yaMigrada); err != nil {
		t.Fatalf("mirar si la base esta vacia: %v", err)
	}
	if yaMigrada {
		t.Fatalf("MIGTEST_DSN tiene que apuntar a una base recien creada (ya tiene schema_migrations)")
	}

	if err := RunMigrations(ctx, pool, migracionesAntesDe(t, migracionesDir, "075_")); err != nil {
		t.Fatalf("migration chain up to 074 failed: %v", err)
	}
	sembrarFechasSinZona(ctx, t, pool)

	poolFueraDeUTC := poolEnZona(ctx, t, dsn, zonaFueraDeUTC)
	defer poolFueraDeUTC.Close()
	if err := RunMigrations(ctx, poolFueraDeUTC, migracionesDir); err != nil {
		t.Fatalf("migration chain failed: %v", err)
	}

	// Re-running must be a clean no-op (idempotent applied-tracking).
	if err := RunMigrations(ctx, pool, migracionesDir); err != nil {
		t.Fatalf("second migration run not idempotent: %v", err)
	}

	exigirFechasConZona(ctx, t, pool)
	exigirVistas(ctx, t, pool)
	exigirFechasSembradas(ctx, t, pool)
	exigirTasaPorInstante(ctx, t, pool)
	exigirBajadaDeLa075(ctx, t, pool)
}

// sesion es lo que estas pruebas usan de un pool o de una transaccion.
type sesion interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// migracionesAntesDe copia a un directorio temporal las migraciones que van
// antes de `primera` (por nombre, que es el orden en que se aplican). Las
// copias son identicas, con el mismo checksum: la corrida siguiente sobre el
// directorio completo las da por aplicadas y sigue desde `primera`.
func migracionesAntesDe(t *testing.T, dir, primera string) string {
	t.Helper()
	entradas, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("leer %s: %v", dir, err)
	}
	destino := t.TempDir()
	for _, e := range entradas {
		nombre := e.Name()
		if e.IsDir() || !strings.HasSuffix(nombre, ".sql") || nombre >= primera {
			continue
		}
		cuerpo, err := os.ReadFile(filepath.Join(dir, nombre))
		if err != nil {
			t.Fatalf("leer %s: %v", nombre, err)
		}
		if err := os.WriteFile(filepath.Join(destino, nombre), cuerpo, 0o600); err != nil {
			t.Fatalf("copiar %s: %v", nombre, err)
		}
	}
	return destino
}

// zonaFueraDeUTC es la zona de la sesion que aplica la cadena desde la 075, y
// la de las consultas que no deben depender de ella. Produccion corre en UTC, y
// en UTC una fecha sin zona leida con la zona de la sesion da el mismo instante
// que leida como UTC: una conversion mal hecha pasaria igual. Costa Rica esta
// seis horas detras de UTC y no tiene horario de verano.
const zonaFueraDeUTC = "America/Costa_Rica"

// poolEnZona abre un pool cuyas sesiones arrancan en `zona`.
func poolEnZona(ctx context.Context, t *testing.T, dsn, zona string) *pgxpool.Pool {
	t.Helper()
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatalf("leer MIGTEST_DSN: %v", err)
	}
	cfg.ConnConfig.RuntimeParams["timezone"] = zona
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatalf("connect en %s: %v", zona, err)
	}
	var enUso string
	if err := pool.QueryRow(ctx, `SELECT current_setting('TimeZone')`).Scan(&enUso); err != nil {
		pool.Close()
		t.Fatalf("leer la zona de la sesion: %v", err)
	}
	if enUso != zona {
		pool.Close()
		t.Fatalf("la sesion quedo en %q, no en %q", enUso, zona)
	}
	return pool
}

// Las fechas que sembrarFechasSinZona escribe sin zona. Sembradas con la cadena
// en la 074, la 075 tiene que leerlas como UTC (lo que produccion guardaba), no
// en la zona de la sesion que la aplica.
var (
	instanteSembrado          = time.Date(2026, 3, 1, 15, 30, 0, 0, time.UTC)
	instanteSembradoSiguiente = time.Date(2026, 3, 2, 15, 30, 0, 0, time.UTC)
)

// sembrarFechasSinZona deja, con la cadena en la 074, una cuenta y dos tasas de
// un par que nada mas usa (ZZA/ZZB) con fechas sin zona conocidas. Las dos
// tasas se reparten el tiempo en instanteSembradoSiguiente: la de 2 rige antes,
// la de 3 despues (y es la vigente).
func sembrarFechasSinZona(ctx context.Context, t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	if _, err := pool.Exec(ctx, `
		INSERT INTO users (id, cedula_enc, cedula_hash, phone_enc, phone_hash,
		                   first_name, last_name, password_hash, referral_code,
		                   created_at, updated_at, last_login_at, kyc_verified_at)
		VALUES ('07500000-0000-4000-8000-000000000075',
		        fn_pii_encrypt('107500075'), fn_pii_hmac('107500075'),
		        fn_pii_encrypt('87500075'), fn_pii_hmac('87500075'),
		        'Prueba', 'Zona', 'sin-uso', 'ZONA0075',
		        TIMESTAMP '2026-03-01 15:30:00', TIMESTAMP '2026-03-01 15:30:00',
		        TIMESTAMP '2026-03-01 15:30:00', TIMESTAMP '2026-03-01 15:30:00')`); err != nil {
		t.Fatalf("sembrar la cuenta en la 074: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO exchange_rates (from_currency, to_currency, rate, source, effective_from, effective_to)
		VALUES ('ZZA', 'ZZB', 2, 'manual', TIMESTAMP '2026-03-01 15:30:00', TIMESTAMP '2026-03-02 15:30:00')`); err != nil {
		t.Fatalf("sembrar la tasa cerrada en la 074: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO exchange_rates (from_currency, to_currency, rate, source, effective_from)
		VALUES ('ZZA', 'ZZB', 3, 'manual', TIMESTAMP '2026-03-02 15:30:00')`); err != nil {
		t.Fatalf("sembrar la tasa vigente en la 074: %v", err)
	}
}

// fechasSembradas lee las fechas que sembro sembrarFechasSinZona, tambien a
// traves de las dos vistas que la 075 vuelve a crear. Sirve con las columnas
// con zona (despues de la 075) y sin zona (despues de su bajada): pgx lee un
// timestamp sin zona como hora de UTC.
const fechasSembradas = `
	SELECT 'users.created_at', created_at FROM users WHERE id = '07500000-0000-4000-8000-000000000075'
	UNION ALL SELECT 'users.updated_at', updated_at FROM users WHERE id = '07500000-0000-4000-8000-000000000075'
	UNION ALL SELECT 'users.last_login_at', last_login_at FROM users WHERE id = '07500000-0000-4000-8000-000000000075'
	UNION ALL SELECT 'users.kyc_verified_at', kyc_verified_at FROM users WHERE id = '07500000-0000-4000-8000-000000000075'
	UNION ALL SELECT 'users_masked.created_at', created_at FROM users_masked WHERE id = '07500000-0000-4000-8000-000000000075'
	UNION ALL SELECT 'exchange_rates.effective_from', effective_from FROM exchange_rates
		WHERE from_currency = 'ZZA' AND to_currency = 'ZZB' AND rate = 2
	UNION ALL SELECT 'exchange_rates.effective_to', effective_to FROM exchange_rates
		WHERE from_currency = 'ZZA' AND to_currency = 'ZZB' AND rate = 2
	UNION ALL SELECT 'current_exchange_rates.effective_from', effective_from FROM current_exchange_rates
		WHERE from_currency = 'ZZA' AND to_currency = 'ZZB'`

var fechasEsperadas = map[string]time.Time{
	"users.created_at":                      instanteSembrado,
	"users.updated_at":                      instanteSembrado,
	"users.last_login_at":                   instanteSembrado,
	"users.kyc_verified_at":                 instanteSembrado,
	"users_masked.created_at":               instanteSembrado,
	"exchange_rates.effective_from":         instanteSembrado,
	"exchange_rates.effective_to":           instanteSembradoSiguiente,
	"current_exchange_rates.effective_from": instanteSembradoSiguiente,
}

// compararFechasSembradas falla si una fecha sembrada no esta o no es el
// instante que se sembro.
func compararFechasSembradas(ctx context.Context, t *testing.T, s sesion, cuando string) {
	t.Helper()
	// Protocolo simple: la misma consulta corre antes y despues de la bajada, y
	// sus columnas cambian de tipo. El plan que pgx prepara y guarda en la
	// conexion ya no serviria ("cached plan must not change result type").
	filas, err := s.Query(ctx, fechasSembradas, pgx.QueryExecModeSimpleProtocol)
	if err != nil {
		t.Fatalf("%s: leer las fechas sembradas: %v", cuando, err)
	}
	leidas := map[string]time.Time{}
	for filas.Next() {
		var nombre string
		var valor time.Time
		if err := filas.Scan(&nombre, &valor); err != nil {
			filas.Close()
			t.Fatalf("%s: leer las fechas sembradas: %v", cuando, err)
		}
		leidas[nombre] = valor
	}
	filas.Close()
	if err := filas.Err(); err != nil {
		t.Fatalf("%s: leer las fechas sembradas: %v", cuando, err)
	}
	for nombre, esperada := range fechasEsperadas {
		leida, ok := leidas[nombre]
		switch {
		case !ok:
			t.Errorf("%s: %s no esta", cuando, nombre)
		case !leida.Equal(esperada):
			t.Errorf("%s: %s = %s UTC, se sembro %s UTC", cuando, nombre,
				leida.UTC().Format(time.DateTime), esperada.Format(time.DateTime))
		}
	}
}

// exigirFechasSembradas: despues de la 075, aplicada fuera de UTC, cada fecha
// sembrada sigue siendo el mismo instante.
func exigirFechasSembradas(ctx context.Context, t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	compararFechasSembradas(ctx, t, pool, "despues de la cadena")
}

// exigirVistas falla si falta una de las vistas que la 075 borra y vuelve a
// crear.
func exigirVistas(ctx context.Context, t *testing.T, s sesion) {
	t.Helper()
	for _, vista := range []string{"users_masked", "current_exchange_rates"} {
		if _, err := s.Exec(ctx, "SELECT 1 FROM "+vista+" LIMIT 0"); err != nil {
			t.Errorf("la vista %s no se puede leer: %v", vista, err)
		}
	}
}

// exigirTasaPorInstante: fn_fx_rate_at da la tasa que regia en un instante,
// pregunte desde la zona que pregunte. A las 12:00 UTC del 2 de marzo rige la
// tasa de 2 (la de 3 empieza a las 15:30 UTC). Con el instante sin zona de la
// 021, desde Costa Rica la funcion leia esas 12:00 como hora local, las 18:00
// UTC, y daba la de 3.
func exigirTasaPorInstante(ctx context.Context, t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("abrir la transaccion: %v", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	if _, err := tx.Exec(ctx, `SELECT set_config('TimeZone', $1, true)`, zonaFueraDeUTC); err != nil {
		t.Fatalf("poner la sesion en %s: %v", zonaFueraDeUTC, err)
	}

	var conZona, sinZona bool
	if err := tx.QueryRow(ctx, `
		SELECT to_regprocedure('fn_fx_rate_at(varchar, varchar, timestamptz)') IS NOT NULL,
		       to_regprocedure('fn_fx_rate_at(varchar, varchar, timestamp)') IS NOT NULL`).
		Scan(&conZona, &sinZona); err != nil {
		t.Fatalf("buscar fn_fx_rate_at: %v", err)
	}
	if !conZona {
		t.Errorf("fn_fx_rate_at no recibe el instante con zona (timestamptz)")
	}
	if sinZona {
		t.Errorf("sigue la fn_fx_rate_at que recibe el instante sin zona (timestamp)")
	}

	var tasa *float64
	if err := tx.QueryRow(ctx,
		`SELECT fn_fx_rate_at('ZZA', 'ZZB', '2026-03-02 12:00:00+00')`).Scan(&tasa); err != nil {
		t.Fatalf("fn_fx_rate_at: %v", err)
	}
	switch {
	case tasa == nil:
		t.Errorf("fn_fx_rate_at a las 12:00 UTC del 2 de marzo = NULL, se esperaba 2")
	case *tasa != 2:
		t.Errorf("fn_fx_rate_at a las 12:00 UTC del 2 de marzo = %v, se esperaba 2", *tasa)
	}
}

// columnasDeLa075 son las quince columnas que la 075 pasa a TIMESTAMPTZ.
var columnasDeLa075 = []string{
	"assistant_conversations.created_at",
	"assistant_conversations.updated_at",
	"exchange_rates.effective_from",
	"exchange_rates.effective_to",
	"merchant_catalog_items.created_at",
	"merchant_locations.created_at",
	"merchant_staff.created_at",
	"merchant_staff.revoked_at",
	"totp_recovery_codes.invalidated_at",
	"user_totp.disabled_at",
	"users.created_at",
	"users.deleted_at",
	"users.kyc_verified_at",
	"users.last_login_at",
	"users.updated_at",
}

// bajadasHastaLa075 son las bajadas que hay que aplicar, en este orden, para
// volver de la punta de la cadena a antes de la 075. Una migracion posterior que
// lea esas columnas desde una vista o las cambie lleva su bajada aca, antes de
// la de la 075.
var bajadasHastaLa075 = []string{
	"076_fn_fx_rate_at_con_zona.down.sql",
	"075_fechas_con_zona.down.sql",
}

// exigirBajadaDeLa075 aplica las bajadas hasta antes de la 075, fuera de UTC,
// dentro de una transaccion que despues se deshace: la base queda como estaba.
// Las quince columnas vuelven a ser sin zona, con la hora de UTC de lo que
// guardaban, las dos vistas siguen, y fn_fx_rate_at vuelve a recibir el
// instante sin zona, como en la 021.
func exigirBajadaDeLa075(ctx context.Context, t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("abrir la transaccion: %v", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	if _, err := tx.Exec(ctx, `SELECT set_config('TimeZone', $1, true)`, zonaFueraDeUTC); err != nil {
		t.Fatalf("poner la sesion en %s: %v", zonaFueraDeUTC, err)
	}
	for _, nombre := range bajadasHastaLa075 {
		cuerpo, err := os.ReadFile(filepath.Join(migracionesDir, "down", nombre))
		if err != nil {
			t.Fatalf("leer la bajada %s: %v", nombre, err)
		}
		if _, err := tx.Exec(ctx, string(cuerpo)); err != nil {
			t.Fatalf("aplicar la bajada %s: %v", nombre, err)
		}
	}

	sinZona := columnasSinZona(ctx, t, tx)
	if strings.Join(sinZona, ",") != strings.Join(columnasDeLa075, ",") {
		t.Errorf("despues de la bajada quedan sin zona %v, se esperaban %v", sinZona, columnasDeLa075)
	}
	exigirVistas(ctx, t, tx)
	compararFechasSembradas(ctx, t, tx, "despues de la bajada")

	var comoLa021 bool
	if err := tx.QueryRow(ctx,
		`SELECT to_regprocedure('fn_fx_rate_at(varchar, varchar, timestamp)') IS NOT NULL`).
		Scan(&comoLa021); err != nil {
		t.Fatalf("buscar fn_fx_rate_at despues de la bajada: %v", err)
	}
	if !comoLa021 {
		t.Errorf("despues de la bajada no esta la fn_fx_rate_at de la 021 (instante sin zona)")
	}
}

// columnasSinZona devuelve, ordenadas, las columnas timestamp sin zona de las
// tablas del esquema public.
func columnasSinZona(ctx context.Context, t *testing.T, s sesion) []string {
	t.Helper()
	filas, err := s.Query(ctx, `
		SELECT c.relname || '.' || a.attname
		FROM pg_attribute a
		JOIN pg_class c ON c.oid = a.attrelid
		JOIN pg_namespace n ON n.oid = c.relnamespace
		WHERE n.nspname = 'public'
		  AND c.relkind IN ('r', 'p')
		  AND NOT c.relispartition
		  AND a.attnum > 0
		  AND NOT a.attisdropped
		  AND a.atttypid = 'timestamp'::regtype`)
	if err != nil {
		t.Fatalf("leer las columnas sin zona: %v", err)
	}
	columnas, err := pgx.CollectRows(filas, pgx.RowTo[string])
	if err != nil {
		t.Fatalf("leer las columnas sin zona: %v", err)
	}
	sort.Strings(columnas)
	return columnas
}

// sinZonaConocidas son las columnas que siguen siendo timestamp sin zona al
// final de la cadena. La 034 convirtio todas las que habia, salvo las que usaba
// una vista (Postgres no cambia el tipo de una columna que una vista lee), y
// despues de la 034 tres migraciones volvieron a crear columnas sin zona. La
// 075 convirtio esas quince: la lista queda vacia, y una columna sin zona nueva
// es un error.
var sinZonaConocidas = map[string]bool{}

// exigirFechasConZona falla si al final de la cadena hay una columna timestamp
// sin zona que no este en sinZonaConocidas, o si una de la lista ya no lo es (y
// entonces sobra en ella). Un timestamp sin zona escrito con NOW() guarda la
// hora local del servidor y la aplicacion la lee como UTC (ver la 034). Las
// pruebas de integracion no lo ven: su esquema convierte todo a timestamptz.
func exigirFechasConZona(ctx context.Context, t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	columnas := columnasSinZona(ctx, t, pool)
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
