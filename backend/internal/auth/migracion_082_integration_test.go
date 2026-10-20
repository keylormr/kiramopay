package auth_test

import (
	"context"
	"errors"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/kiramopay/backend/internal/auth"
)

// La migracion 082 se prueba ejecutando SU PROPIO archivo, como la 069: el
// esquema de pruebas no lee migrations/.
func correrArchivo(t *testing.T, pool *pgxpool.Pool, ruta string) {
	t.Helper()
	sql, err := os.ReadFile(ruta)
	if err != nil {
		t.Fatalf("leer migracion: %v", err)
	}
	if _, err := pool.Exec(context.Background(), string(sql)); err != nil {
		t.Fatalf("correr migracion: %v", err)
	}
}

func correr082(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	correrArchivo(t, pool, "../../migrations/082_keilor_administrador.sql")
}

func rolYDemo(t *testing.T, pool *pgxpool.Pool, id string) (string, bool) {
	t.Helper()
	var rol string
	var demo bool
	if err := pool.QueryRow(context.Background(),
		`SELECT role, demo_login FROM users WHERE id = $1::uuid`, id).Scan(&rol, &demo); err != nil {
		t.Fatalf("leer cuenta: %v", err)
	}
	return rol, demo
}

// victorDeDemo siembra una segunda cuenta de demostracion con id propio.
// sembrarConUsuario no sirve para una segunda cuenta: SeedTestUser fija siempre
// el mismo id, y la segunda llamada pisaria a la primera.
func victorDeDemo(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	const id = "00000000-0000-0000-0000-0000000082b1"
	nombre := "victor"
	insertarCuenta(t, pool, id, "101010101", "+50660000082", "user", &nombre)
	if _, err := pool.Exec(context.Background(),
		`UPDATE users SET demo_login = TRUE WHERE id = $1::uuid`, id); err != nil {
		t.Fatalf("marcar a victor como demostracion: %v", err)
	}
	return id
}

// sesionesVigentes cuenta las sesiones y los refresh tokens sin revocar. Una
// sesion revocada en user_sessions deja de valer en la siguiente peticion
// (IsAccessJTIRevoked), y un refresh revocado ya no renueva.
func sesionesVigentes(t *testing.T, pool *pgxpool.Pool, id string) (int, int) {
	t.Helper()
	var sesiones, renovaciones int
	if err := pool.QueryRow(context.Background(), `
		SELECT (SELECT COUNT(*) FROM user_sessions  WHERE user_id = $1::uuid AND revoked_at IS NULL),
		       (SELECT COUNT(*) FROM refresh_tokens WHERE user_id = $1::uuid AND revoked_at IS NULL)`,
		id).Scan(&sesiones, &renovaciones); err != nil {
		t.Fatalf("contar sesiones: %v", err)
	}
	return sesiones, renovaciones
}

// sembrarCredenciales le da a la cuenta lo que una sesion sin contrasena pudo
// dejar creado ademas de la sesion: una llave B2B, un webhook, una suscripcion
// de avisos del navegador y un telefono para avisos de la app.
func sembrarCredenciales(t *testing.T, pool *pgxpool.Pool, id string) {
	t.Helper()
	ctx := context.Background()
	for _, sql := range []string{
		`INSERT INTO api_keys (user_id, name, prefix, key_hash)
		 VALUES ($1::uuid, 'llave', 'kp_test', md5($1::text || 'llave'))`,
		`INSERT INTO webhook_endpoints (user_id, url, secret)
		 VALUES ($1::uuid, 'https://ganchos.example.test/' || $1::text, 'secreto')`,
		`INSERT INTO push_subscriptions (user_id, endpoint, auth_key, p256dh_key)
		 VALUES ($1::uuid, 'https://avisos.example.test/' || $1::text, 'a', 'p')`,
		`INSERT INTO push_dispositivos (user_id, token, plataforma)
		 VALUES ($1::uuid, 'telefono-' || $1::text, 'android')`,
	} {
		if _, err := pool.Exec(ctx, sql, id); err != nil {
			t.Fatalf("sembrar credenciales: %v", err)
		}
	}
}

// credencialesVivas cuenta las llaves activas, los webhooks activos, las
// suscripciones de avisos y los telefonos de la cuenta.
func credencialesVivas(t *testing.T, pool *pgxpool.Pool, id string) (llaves, ganchos, avisos, telefonos int) {
	t.Helper()
	if err := pool.QueryRow(context.Background(), `
		SELECT (SELECT COUNT(*) FROM api_keys           WHERE user_id = $1::uuid AND status = 'active'),
		       (SELECT COUNT(*) FROM webhook_endpoints  WHERE user_id = $1::uuid AND status = 'active'),
		       (SELECT COUNT(*) FROM push_subscriptions WHERE user_id = $1::uuid),
		       (SELECT COUNT(*) FROM push_dispositivos  WHERE user_id = $1::uuid)`,
		id).Scan(&llaves, &ganchos, &avisos, &telefonos); err != nil {
		t.Fatalf("contar credenciales: %v", err)
	}
	return
}

// rolesDados cuenta las filas de auditoria del rol de administrador dado a la
// cuenta: un cambio de privilegio no puede quedar sin rastro.
func rolesDados(t *testing.T, pool *pgxpool.Pool, id string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(), `
		SELECT COUNT(*) FROM audit_logs
		 WHERE action = 'role_granted' AND resource_type = 'user' AND resource_id = $1
		   AND details->>'role' = 'admin' AND details->>'migration' = '082'`,
		id).Scan(&n); err != nil {
		t.Fatalf("contar auditoria: %v", err)
	}
	return n
}

// revocadoSegunLaAuditoria lee lo que la fila de auditoria dice que se revoco,
// en el orden sesiones, refresh tokens, llaves, webhooks, avisos y telefonos.
func revocadoSegunLaAuditoria(t *testing.T, pool *pgxpool.Pool, id string) [6]string {
	t.Helper()
	var r [6]string
	if err := pool.QueryRow(context.Background(), `
		SELECT COALESCE(details->>'sessions_revoked', ''),       COALESCE(details->>'refresh_tokens_revoked', ''),
		       COALESCE(details->>'api_keys_revoked', ''),       COALESCE(details->>'webhooks_disabled', ''),
		       COALESCE(details->>'push_subscriptions_removed', ''), COALESCE(details->>'push_devices_removed', '')
		  FROM audit_logs WHERE action = 'role_granted' AND resource_id = $1`,
		id).Scan(&r[0], &r[1], &r[2], &r[3], &r[4], &r[5]); err != nil {
		t.Fatalf("leer auditoria: %v", err)
	}
	return r
}

// Pedido del dueno (2026-10-19): keilor administra. El CHECK
// chk_users_demo_login_no_admin no deja que un administrador entre sin
// contrasena, asi que keilor deja de ser cuenta de demostracion. Y todo lo que
// una sesion abierta con solo teclear "keilor" pudo dejar se cierra: las
// sesiones (el rol se lee en cada peticion, y sin eso heredarian el panel), las
// llaves B2B y los webhooks, y las suscripciones de avisos, igual que en un
// bloqueo. El cambio de rol queda en audit_logs con lo que se cerro, y las
// demas cuentas de demostracion no se tocan.
func TestMigracion082_KeilorAdministraYPideContrasena(t *testing.T) {
	ctx := context.Background()
	svc, pool, _ := servicioConDemo(t, true)
	keilor := sembrarConUsuario(t, pool, "702650930", "keilor", true)
	victor := victorDeDemo(t, pool)
	sembrarCredenciales(t, pool, keilor)
	sembrarCredenciales(t, pool, victor)

	abierta, err := svc.Login(ctx, &auth.LoginRequest{Identifier: "keilor", Password: ""}, emptyCtx)
	if err != nil {
		t.Fatalf("keilor no entro sin contrasena antes de la migracion: %v", err)
	}
	deVictor, err := svc.Login(ctx, &auth.LoginRequest{Identifier: "victor", Password: ""}, emptyCtx)
	if err != nil {
		t.Fatalf("victor no entro sin contrasena antes de la migracion: %v", err)
	}
	if deVictor.User.ID == keilor {
		t.Fatal("victor y keilor son la misma cuenta: la prueba no distinguiria nada")
	}

	correr082(t, pool)

	if rol, demo := rolYDemo(t, pool, keilor); rol != "admin" || demo {
		t.Fatalf("keilor quedo role=%q demo_login=%v; se esperaba admin y false", rol, demo)
	}
	if n := rolesDados(t, pool, keilor); n != 1 {
		t.Errorf("el rol de administrador quedo %d veces en audit_logs; se esperaba una", n)
	}
	if s, r := sesionesVigentes(t, pool, keilor); s != 0 || r != 0 {
		t.Errorf("keilor conserva %d sesiones y %d refresh tokens abiertos sin contrasena; "+
			"tenian que quedar revocados", s, r)
	}
	if l, g, a, f := credencialesVivas(t, pool, keilor); l != 0 || g != 0 || a != 0 || f != 0 {
		t.Errorf("keilor conserva %d llaves, %d webhooks, %d suscripciones de avisos y %d telefonos; "+
			"tenian que quedar revocados", l, g, a, f)
	}
	if got, want := revocadoSegunLaAuditoria(t, pool, keilor), [6]string{"1", "1", "1", "1", "1", "1"}; got != want {
		t.Errorf("la auditoria dice que se revoco %v; se esperaba %v", got, want)
	}
	if _, err := svc.Refresh(ctx, abierta.Tokens.RefreshToken, emptyCtx); err == nil {
		t.Error("la sesion que keilor abrio sin contrasena se sigue renovando despues de la migracion")
	}
	if _, err := svc.Login(ctx, &auth.LoginRequest{Identifier: "keilor", Password: ""}, emptyCtx); !errors.Is(err, auth.ErrPasswordRequired) {
		t.Errorf("keilor sin contrasena dio %v despues de la migracion; se esperaba ErrPasswordRequired", err)
	}
	if _, err := svc.Login(ctx, &auth.LoginRequest{Identifier: "keilor", Password: "Kiramopay2024!"}, emptyCtx); err != nil {
		t.Errorf("keilor no entro con su contrasena despues de la migracion: %v", err)
	}

	// Control: la misma renovacion SI funciona para quien la migracion no toca,
	// asi que el rechazo de keilor es por la revocacion y no por otra causa.
	if rol, demo := rolYDemo(t, pool, victor); rol != "user" || !demo {
		t.Errorf("victor quedo role=%q demo_login=%v; no debia tocarse", rol, demo)
	}
	if l, g, a, f := credencialesVivas(t, pool, victor); l != 1 || g != 1 || a != 1 || f != 1 {
		t.Errorf("victor quedo con %d llaves, %d webhooks, %d suscripciones y %d telefonos; se esperaba uno de cada uno", l, g, a, f)
	}
	if s, r := sesionesVigentes(t, pool, victor); s != 1 || r != 1 {
		t.Errorf("victor quedo con %d sesiones y %d refresh tokens vigentes; se esperaba 1 y 1", s, r)
	}
	if _, err := svc.Refresh(ctx, deVictor.Tokens.RefreshToken, emptyCtx); err != nil {
		t.Errorf("la sesion de victor dejo de renovarse: %v", err)
	}
	if _, err := svc.Login(ctx, &auth.LoginRequest{Identifier: "victor", Password: ""}, emptyCtx); err != nil {
		t.Errorf("victor dejo de entrar sin contrasena: %v", err)
	}
}

// En una base sin la cuenta (desarrollo nuevo, CI) no hace nada ni aborta el
// arranque. Y correrla otra vez, con keilor ya administrador, no vuelve a cerrar
// sesiones: la que abrio con su contrasena despues de la primera sigue viva. La
// auditoria dice la verdad: en la primera corrida no habia nada que cerrar.
func TestMigracion082_EsIdempotenteYNoAbortaSinLaCuenta(t *testing.T) {
	ctx := context.Background()
	svc, pool, _ := servicioConDemo(t, true)

	correr082(t, pool)

	keilor := sembrarConUsuario(t, pool, "702650930", "keilor", true)
	correr082(t, pool)
	if _, err := svc.Login(ctx, &auth.LoginRequest{Identifier: "keilor", Password: "Kiramopay2024!"}, emptyCtx); err != nil {
		t.Fatalf("keilor no entro con su contrasena: %v", err)
	}

	correr082(t, pool)

	if rol, demo := rolYDemo(t, pool, keilor); rol != "admin" || demo {
		t.Fatalf("keilor quedo role=%q demo_login=%v; se esperaba admin y false", rol, demo)
	}
	if s, r := sesionesVigentes(t, pool, keilor); s != 1 || r != 1 {
		t.Errorf("la segunda corrida dejo a keilor con %d sesiones y %d refresh tokens vigentes; "+
			"se esperaba 1 y 1 (no debia volver a revocar)", s, r)
	}
	if n := rolesDados(t, pool, keilor); n != 1 {
		t.Errorf("tres corridas dejaron %d filas del rol en audit_logs; se esperaba una", n)
	}
	if got, want := revocadoSegunLaAuditoria(t, pool, keilor), [6]string{"0", "0", "0", "0", "0", "0"}; got != want {
		t.Errorf("sin nada que cerrar, la auditoria dice que se revoco %v; se esperaba %v", got, want)
	}
}

// La bajada le quita el rol, la vuelve a marcar como cuenta de demostracion y
// lo deja en la auditoria: quitar un privilegio y reabrir la entrada sin
// contrasena tambien tiene que quedar registrado.
func TestMigracion082_LaBajadaQuitaElRolYLoAudita(t *testing.T) {
	_, pool, _ := servicioConDemo(t, true)
	keilor := sembrarConUsuario(t, pool, "702650930", "keilor", true)
	correr082(t, pool)

	correrArchivo(t, pool, "../../migrations/down/082_keilor_administrador.down.sql")

	if rol, demo := rolYDemo(t, pool, keilor); rol != "user" || !demo {
		t.Fatalf("despues de la bajada keilor quedo role=%q demo_login=%v; se esperaba user y true", rol, demo)
	}
	var n int
	if err := pool.QueryRow(context.Background(), `
		SELECT COUNT(*) FROM audit_logs
		 WHERE action = 'role_revoked' AND resource_type = 'user' AND resource_id = $1
		   AND details->>'role' = 'admin' AND details->>'migration' = '082'`,
		keilor).Scan(&n); err != nil {
		t.Fatalf("contar auditoria: %v", err)
	}
	if n != 1 {
		t.Errorf("la bajada dejo %d filas role_revoked en audit_logs; se esperaba una", n)
	}
}
