package auth_test

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/kiramopay/backend/internal/auth"
)

// La 084 se prueba como la 082: corriendo su propio archivo, porque el esquema
// de pruebas no lee migrations/.
const (
	migracion084 = "../../migrations/084_keilor_administra_sin_contrasena.sql"
	bajada084    = "../../migrations/down/084_keilor_administra_sin_contrasena.down.sql"
)

// filas084 cuenta las filas de auditoria que la 084 dejo para la cuenta con esa
// accion: abrir o cerrar la entrada sin contrasena de un administrador no puede
// quedar sin rastro.
func filas084(t *testing.T, pool *pgxpool.Pool, id, accion string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(), `
		SELECT COUNT(*) FROM audit_logs
		 WHERE action = $2 AND resource_type = 'user' AND resource_id = $1
		   AND details->>'migration' = '084'`,
		id, accion).Scan(&n); err != nil {
		t.Fatalf("contar auditoria: %v", err)
	}
	return n
}

// marcarComoDemo intenta que la cuenta entre sin contrasena y devuelve lo que
// dijo la base.
func marcarComoDemo(pool *pgxpool.Pool, id string) error {
	_, err := pool.Exec(context.Background(),
		`UPDATE users SET demo_login = TRUE WHERE id = $1::uuid`, id)
	return err
}

func esElCheckDeAdministradores(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23514" &&
		pgErr.ConstraintName == "chk_users_demo_login_no_admin"
}

// Decision del dueno (2026-10-27), tomada sabiendo el riesgo: keilor sigue
// administrando y vuelve a entrar sin contrasena, como antes de la 082. La
// prueba parte de donde esta produccion hoy (la 082 aplicada: administra y pide
// contrasena).
func TestMigracion084_KeilorAdministraYEntraSinContrasena(t *testing.T) {
	ctx := context.Background()
	svc, pool, _ := servicioConDemo(t, true)
	keilor := sembrarConUsuario(t, pool, "702650930", "keilor", true)
	correr082(t, pool)
	if _, err := svc.Login(ctx, &auth.LoginRequest{Identifier: "keilor", Password: ""}, emptyCtx); !errors.Is(err, auth.ErrPasswordRequired) {
		t.Fatalf("antes de la 084 keilor sin contrasena dio %v; se esperaba ErrPasswordRequired", err)
	}

	correrArchivo(t, pool, migracion084)

	if rol, demo := rolYDemo(t, pool, keilor); rol != "admin" || !demo {
		t.Fatalf("keilor quedo role=%q demo_login=%v; se esperaba admin y true", rol, demo)
	}
	res, err := svc.Login(ctx, &auth.LoginRequest{Identifier: "keilor", Password: ""}, emptyCtx)
	if err != nil {
		t.Fatalf("keilor no entro sin contrasena despues de la 084: %v", err)
	}
	if res.User.ID != keilor {
		t.Errorf("entrar como keilor abrio la cuenta %s; se esperaba %s", res.User.ID, keilor)
	}
	if n := filas084(t, pool, keilor, "demo_login_enabled"); n != 1 {
		t.Errorf("la entrada sin contrasena quedo %d veces en audit_logs; se esperaba una", n)
	}
}

// La bandera del servidor sigue mandando: con DEMO_LOGIN_ENABLED apagada,
// keilor pide contrasena como cualquier cuenta, y con ella entra.
func TestMigracion084_ConLaBanderaApagadaKeilorPideContrasena(t *testing.T) {
	ctx := context.Background()
	svc, pool, _ := servicioConDemo(t, false)
	sembrarConUsuario(t, pool, "702650930", "keilor", true)
	correr082(t, pool)
	correrArchivo(t, pool, migracion084)

	if _, err := svc.Login(ctx, &auth.LoginRequest{Identifier: "keilor", Password: ""}, emptyCtx); !errors.Is(err, auth.ErrPasswordRequired) {
		t.Errorf("con la bandera apagada keilor sin contrasena dio %v; se esperaba ErrPasswordRequired", err)
	}
	if _, err := svc.Login(ctx, &auth.LoginRequest{Identifier: "keilor", Password: "Kiramopay2024!"}, emptyCtx); err != nil {
		t.Errorf("con la bandera apagada keilor no entro con su contrasena: %v", err)
	}
}

// La excepcion es keilor y nadie mas: admin.kp, y un administrador sin nombre
// de usuario, siguen sin poder entrar sin contrasena. El segundo caso es la
// trampa del NULL: un CHECK que da NULL deja pasar la fila.
func TestMigracion084_LaExcepcionEsSoloKeilor(t *testing.T) {
	_, pool, _ := servicioConDemo(t, true)
	sembrarConUsuario(t, pool, "702650930", "keilor", true)
	correr082(t, pool)
	correrArchivo(t, pool, migracion084)

	adminKP := "00000000-0000-0000-0000-0000000084a1"
	sinNombre := "00000000-0000-0000-0000-0000000084a2"
	nombre := "admin.kp"
	insertarCuenta(t, pool, adminKP, "700000000", "+50660000084", "admin", &nombre)
	insertarCuenta(t, pool, sinNombre, "212121212", "+50660000085", "admin", nil)

	for _, c := range []struct{ que, id string }{
		{"admin.kp", adminKP},
		{"un administrador sin nombre de usuario", sinNombre},
	} {
		if err := marcarComoDemo(pool, c.id); !esElCheckDeAdministradores(err) {
			t.Errorf("marcar a %s para entrar sin contrasena dio %v; se esperaba la violacion de chk_users_demo_login_no_admin", c.que, err)
		}
	}
}

// En una base sin la cuenta (desarrollo nuevo, CI) no hace nada ni aborta el
// arranque, y correrla otra vez no duplica la auditoria.
func TestMigracion084_EsIdempotenteYNoAbortaSinLaCuenta(t *testing.T) {
	_, pool, _ := servicioConDemo(t, true)
	correrArchivo(t, pool, migracion084)

	keilor := sembrarConUsuario(t, pool, "702650930", "keilor", true)
	correr082(t, pool)
	correrArchivo(t, pool, migracion084)
	correrArchivo(t, pool, migracion084)

	if rol, demo := rolYDemo(t, pool, keilor); rol != "admin" || !demo {
		t.Fatalf("keilor quedo role=%q demo_login=%v; se esperaba admin y true", rol, demo)
	}
	if n := filas084(t, pool, keilor, "demo_login_enabled"); n != 1 {
		t.Errorf("tres corridas dejaron %d filas en audit_logs; se esperaba una", n)
	}
}

// La bajada vuelve a pedir contrasena y cierra lo que se abrio sin ella, como
// la 082: sin eso, una sesion abierta tecleando solo "keilor" seguiria en el
// panel. Y el CHECK vuelve a ser el de la 058: ningun administrador sin
// contrasena, keilor incluido.
func TestMigracion084_LaBajadaVuelveAPedirContrasenaYCierraLoAbierto(t *testing.T) {
	ctx := context.Background()
	svc, pool, _ := servicioConDemo(t, true)
	keilor := sembrarConUsuario(t, pool, "702650930", "keilor", true)
	correr082(t, pool)
	correrArchivo(t, pool, migracion084)
	abierta, err := svc.Login(ctx, &auth.LoginRequest{Identifier: "keilor", Password: ""}, emptyCtx)
	if err != nil {
		t.Fatalf("keilor no entro sin contrasena antes de la bajada: %v", err)
	}
	sembrarCredenciales(t, pool, keilor)

	correrArchivo(t, pool, bajada084)

	if rol, demo := rolYDemo(t, pool, keilor); rol != "admin" || demo {
		t.Fatalf("despues de la bajada keilor quedo role=%q demo_login=%v; se esperaba admin y false", rol, demo)
	}
	if s, r := sesionesVigentes(t, pool, keilor); s != 0 || r != 0 {
		t.Errorf("keilor conserva %d sesiones y %d refresh tokens abiertos sin contrasena; tenian que quedar revocados", s, r)
	}
	if l, g, a, f := credencialesVivas(t, pool, keilor); l != 0 || g != 0 || a != 0 || f != 0 {
		t.Errorf("keilor conserva %d llaves, %d webhooks, %d suscripciones de avisos y %d telefonos; "+
			"tenian que quedar revocados", l, g, a, f)
	}
	if _, err := svc.Refresh(ctx, abierta.Tokens.RefreshToken, emptyCtx); err == nil {
		t.Error("la sesion que keilor abrio sin contrasena se sigue renovando despues de la bajada")
	}
	if _, err := svc.Login(ctx, &auth.LoginRequest{Identifier: "keilor", Password: ""}, emptyCtx); !errors.Is(err, auth.ErrPasswordRequired) {
		t.Errorf("despues de la bajada keilor sin contrasena dio %v; se esperaba ErrPasswordRequired", err)
	}
	if n := filas084(t, pool, keilor, "demo_login_disabled"); n != 1 {
		t.Errorf("la bajada dejo %d filas demo_login_disabled en audit_logs; se esperaba una", n)
	}
	if err := marcarComoDemo(pool, keilor); !esElCheckDeAdministradores(err) {
		t.Errorf("despues de la bajada, marcar a keilor sin contrasena dio %v; se esperaba la violacion del CHECK de la 058", err)
	}
}
