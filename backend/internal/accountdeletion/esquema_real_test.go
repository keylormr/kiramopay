package accountdeletion

import (
	"context"
	"os"
	"sort"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kiramopay/backend/internal/database"
)

// Estas pruebas corren contra el esquema que dejan las MIGRACIONES REALES, no
// contra el que declara testutil a mano. Es lo unico que prueba que el SQL de la
// eliminacion es valido en produccion: un nombre de columna que testutil
// declarara distinto pasaria verde en las demas pruebas y fallaria en el primer
// borrado real.
//
// Se activan con MIGTEST_DSN, la misma variable de la prueba de la cadena de
// migraciones, y la base tiene que traer el parametro kiramopay.encryption_key.

func poolDeLaCadena(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("MIGTEST_DSN")
	if dsn == "" {
		t.Skip("defina MIGTEST_DSN para probar contra el esquema de las migraciones reales")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("conectar: %v", err)
	}
	t.Cleanup(pool.Close)
	// Idempotente: si la cadena ya se aplico, no hace nada.
	if err := database.RunMigrations(ctx, pool, "../../migrations"); err != nil {
		t.Fatalf("cadena de migraciones: %v", err)
	}
	return pool
}

// Toda tabla que apunta a una persona esta clasificada, y toda clasificada
// existe. Es la defensa contra la tabla nueva con datos personales que nadie
// pensaria al eliminar una cuenta.
func TestClasificacionCubreElEsquema(t *testing.T) {
	pool := poolDeLaCadena(t)
	ctx := context.Background()

	// Tablas con una clave foranea hacia users, o con una columna user_id aunque
	// no tengan la clave (transactions, sinpe_history y audit_logs no la tienen
	// a proposito). Las particiones se excluyen: cuelgan de su tabla madre.
	filas, err := pool.Query(ctx, `
		WITH tablas AS (
		    SELECT c.oid, c.relname FROM pg_class c
		      JOIN pg_namespace n ON n.oid = c.relnamespace
		     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relispartition
		)
		SELECT DISTINCT t.relname FROM tablas t
		 WHERE EXISTS (SELECT 1 FROM pg_constraint k
		                WHERE k.conrelid = t.oid AND k.contype = 'f' AND k.confrelid = 'public.users'::regclass)
		    OR EXISTS (SELECT 1 FROM information_schema.columns col
		                WHERE col.table_schema = 'public' AND col.table_name = t.relname
		                  AND col.column_name = 'user_id')
		 ORDER BY 1`)
	if err != nil {
		t.Fatalf("consultar el esquema: %v", err)
	}
	defer filas.Close()
	enElEsquema := map[string]bool{}
	for filas.Next() {
		var n string
		if err := filas.Scan(&n); err != nil {
			t.Fatal(err)
		}
		enElEsquema[n] = true
	}

	var sinClasificar, sobran []string
	for n := range enElEsquema {
		if _, ok := Clasificacion[n]; !ok {
			sinClasificar = append(sinClasificar, n)
		}
	}
	for n := range Clasificacion {
		if !enElEsquema[n] {
			sobran = append(sobran, n)
		}
	}
	sort.Strings(sinClasificar)
	sort.Strings(sobran)
	if len(sinClasificar) > 0 {
		t.Errorf("tablas con datos de una persona SIN clasificar en Clasificacion (decidir si se borran, anonimizan o conservan al eliminar la cuenta): %v", sinClasificar)
	}
	if len(sobran) > 0 {
		t.Errorf("Clasificacion nombra tablas que ya no apuntan a una persona o no existen: %v", sobran)
	}

	// Las de apoyo tampoco pueden quedar colgando de algo que ya no existe.
	for n := range tablasDeApoyo {
		var existe bool
		if err := pool.QueryRow(ctx, `SELECT to_regclass('public.' || $1) IS NOT NULL`, n).Scan(&existe); err != nil || !existe {
			t.Errorf("tablasDeApoyo nombra %q, que no existe", n)
		}
	}
}

// Corre el ciclo ENTERO contra el esquema real: dia 0, reactivacion, otra vez el
// dia 0, el cierre del dia 30 y la desasociacion. Si una sentencia nombra una
// columna que produccion no tiene, o una restriccion (los CHECK de la 077, la FK
// de las sesiones, una columna NOT NULL) la rechaza, falla aqui y no en el
// primer cierre real. El nombre se conserva porque el paso del CI lo nombra.
func TestEliminarFuncionaContraElEsquemaReal(t *testing.T) {
	pool := poolDeLaCadena(t)
	ctx := context.Background()
	a, b := sembrar(t, pool), sembrar(t, pool)
	sembrarTodo(t, pool, a, b)
	asientos := cuenta1[int](t, pool, `SELECT COUNT(*) FROM journal_entries`)
	svc := nuevoServicio(pool, nil)

	// Dia 0 y reactivacion.
	res, err := svc.EliminarMiCuenta(ctx, a.ID, Confirmacion{Password: claveDePrueba, AceptaPlazo: true})
	if err != nil {
		t.Fatalf("pedir la eliminacion contra el esquema real: %v", err)
	}
	if res.Ya {
		t.Fatal("no debia tener una solicitud")
	}
	if st := cuenta1[string](t, pool, `SELECT status FROM users WHERE id = $1::uuid`, a.ID); st != "pending_deletion" {
		t.Fatalf("el dia 0 la dejo en %s", st)
	}
	if ok, err := svc.Reactivar(ctx, a.ID); err != nil || !ok {
		t.Fatalf("reactivar contra el esquema real: ok=%v err=%v", ok, err)
	}
	if st := cuenta1[string](t, pool, `SELECT status FROM users WHERE id = $1::uuid`, a.ID); st != "active" {
		t.Fatalf("reactivada quedo en %s", st)
	}

	// Otra vez el dia 0, y el cierre.
	pedir(t, svc, a.ID)
	cerrar(t, pool, svc, a.ID)
	if n := cuenta1[int](t, pool, `SELECT COUNT(*) FROM journal_entries`); n != asientos {
		t.Errorf("el diario cambio: %d -> %d", asientos, n)
	}
	if n := cuenta1[int](t, pool, `SELECT COUNT(*) FROM ledger_accounts WHERE user_id = $1::uuid AND closed_at IS NULL`, a.ID); n != 0 {
		t.Errorf("%d cuentas del libro siguen abiertas", n)
	}
	if got := descifrar(t, pool, "closed_account_records", "cedula_enc", a.ID); got != a.Cedula {
		t.Errorf("la identidad conservada no es la de la persona: %q", got)
	}
	// users_masked (la vista del panel) ya no la ve.
	if n := cuenta1[int](t, pool, `SELECT COUNT(*) FROM users_masked WHERE id = $1::uuid`, a.ID); n != 0 {
		t.Error("la vista del panel todavia muestra la cuenta cerrada")
	}

	// La desasociacion, vencida la conservacion.
	envejecer(t, pool, a.ID, 5)
	if _, err := svc.DesasociarVencidas(ctx, time.Now(), 100); err != nil {
		t.Fatalf("desasociar contra el esquema real: %v", err)
	}
	if !cuenta1[bool](t, pool, `SELECT dissociated_at IS NOT NULL FROM users WHERE id = $1::uuid`, a.ID) {
		t.Error("la cuenta no quedo desasociada")
	}
	if n := cuenta1[int](t, pool, `SELECT COUNT(*) FROM audit_logs WHERE user_id = $1::uuid AND ip_address IS NOT NULL`, a.ID); n != 0 {
		t.Errorf("%d filas de auditoria conservan la IP", n)
	}

	// La otra persona sigue usable.
	if cuenta1[string](t, pool, `SELECT status FROM users WHERE id = $1::uuid`, b.ID) != "active" {
		t.Error("la otra persona resulto afectada")
	}
}

// La bandeja de la respuesta escrita contra el esquema real: el dia 0 la deja,
// el barrido la intenta, el panel la lista con la cuenta enmascarada (la vista
// users_masked) y operaciones la marca entregada. Si una sentencia nombra una
// columna que la 083 no tiene, o un CHECK la rechaza, falla aqui.
func TestRespuestaContraElEsquemaReal(t *testing.T) {
	pool := poolDeLaCadena(t)
	ctx := context.Background()
	a, admin := sembrar(t, pool), sembrar(t, pool)
	svc := nuevoServicio(pool, nil)

	if _, err := svc.EliminarMiCuenta(ctx, a.ID, Confirmacion{Password: claveDePrueba, AceptaPlazo: true}); err != nil {
		t.Fatalf("pedir la eliminacion: %v", err)
	}
	// Sin proveedor no hay a donde mandarla: pasa a operaciones.
	if _, err := svc.EntregarRespuestas(ctx, time.Now(), 100); err != nil {
		t.Fatalf("barrido de la bandeja: %v", err)
	}
	lista, err := svc.RespuestasSinEntregar(ctx, 100)
	if err != nil {
		t.Fatalf("listar las respuestas sin entregar: %v", err)
	}
	var id string
	for _, r := range lista {
		if r.Cuenta != nil && r.Cuenta.ID == a.ID {
			id = r.ID
		}
	}
	if id == "" {
		t.Fatalf("el panel no lista la respuesta de la cuenta: %+v", lista)
	}
	if err := svc.MarcarRespuestaEntregada(ctx, id, admin.ID, "entregada a mano en la prueba"); err != nil {
		t.Fatalf("marcarla entregada: %v", err)
	}

	// Una cuenta sin correo que dio uno para la respuesta: la marca del correo
	// sin confirmar y ver su contacto, con la vista en la auditoria.
	b := sembrar(t, pool)
	sinCorreo(t, pool, b.ID)
	conCorreoDado(t, svc, b.ID)
	if _, err := svc.EntregarRespuestas(ctx, time.Now(), 100); err != nil {
		t.Fatalf("barrido de la bandeja: %v", err)
	}
	p := enElPanel(t, svc, b.ID)
	if p == nil || !p.CorreoSinConfirmar {
		t.Fatalf("el panel debe marcar el correo sin confirmar: %+v", p)
	}
	if c, err := svc.ContactoDeRespuesta(ctx, p.ID, admin.ID); err != nil || c.CorreoParaRespuesta != correoDado {
		t.Fatalf("ver el contacto: %+v %v", c, err)
	}

	// El rechazo de una solicitud web tambien va por la bandeja: su tipo entra en
	// el CHECK de la 083.
	c := sembrar(t, pool)
	correo := nuevoCorreo()
	conCodigo := nuevoServicio(pool, &Options{Email: correo})
	solicitud := solicitudEnLaCola(t, pool, conCodigo, correo, c)
	// La cuenta en revision tiene su respuesta sin decidir desde la verificacion,
	// y rechazar completa esa misma fila.
	sinDecidir := unaRespuesta(t, pool, c.ID)
	if sinDecidir.Tipo != RespuestaSinDecidir {
		t.Fatalf("al verificar debia quedar una respuesta sin decidir: %+v", sinDecidir)
	}
	if err := conCodigo.Rechazar(ctx, solicitud, admin.ID); err != nil {
		t.Fatalf("rechazar: %v", err)
	}
	if r := esperarRespuesta(t, pool, c.ID, "la del rechazo, entregada", func(r filaRespuesta) bool {
		return r.Tipo == RespuestaRechazada && r.Entregada
	}); r.ID != sinDecidir.ID {
		t.Errorf("rechazar debia completar la fila sin decidir: %+v", r)
	}

	// La que salio al correo dado queda en la lista de las enviadas a un correo
	// sin confirmar.
	d := sembrar(t, pool)
	sinCorreo(t, pool, d.ID)
	conCorreoDado(t, conCodigo, d.ID)
	esperarRespuesta(t, pool, d.ID, "entregada al correo dado", func(r filaRespuesta) bool { return r.Entregada })
	if enviadaSinConfirmar(t, conCodigo, d.ID) == nil {
		t.Fatal("la lista de las enviadas a un correo sin confirmar no la tiene")
	}
}
