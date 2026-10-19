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
func correr082(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	sql, err := os.ReadFile("../../migrations/082_keilor_administrador.sql")
	if err != nil {
		t.Fatalf("leer migracion: %v", err)
	}
	if _, err := pool.Exec(context.Background(), string(sql)); err != nil {
		t.Fatalf("correr migracion: %v", err)
	}
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

// Pedido del dueno (2026-10-19): keilor administra. El CHECK
// chk_users_demo_login_no_admin no deja que un administrador entre sin
// contrasena, asi que keilor deja de ser cuenta de demostracion. Y las sesiones
// que tenia abiertas se cierran: el rol se lee en cada peticion, y sin eso una
// sesion abierta con solo teclear "keilor" heredaria el panel de
// administracion. Las demas cuentas de demostracion no se tocan.
func TestMigracion082_KeilorAdministraYPideContrasena(t *testing.T) {
	ctx := context.Background()
	svc, pool, _ := servicioConDemo(t, true)
	keilor := sembrarConUsuario(t, pool, "702650930", "keilor", true)
	victor := sembrarConUsuario(t, pool, "101010101", "victor", true)

	abierta, err := svc.Login(ctx, &auth.LoginRequest{Identifier: "keilor", Password: ""}, emptyCtx)
	if err != nil {
		t.Fatalf("keilor no entro sin contrasena antes de la migracion: %v", err)
	}
	if _, err := svc.Login(ctx, &auth.LoginRequest{Identifier: "victor", Password: ""}, emptyCtx); err != nil {
		t.Fatalf("victor no entro sin contrasena antes de la migracion: %v", err)
	}

	correr082(t, pool)

	if rol, demo := rolYDemo(t, pool, keilor); rol != "admin" || demo {
		t.Fatalf("keilor quedo role=%q demo_login=%v; se esperaba admin y false", rol, demo)
	}
	if s, r := sesionesVigentes(t, pool, keilor); s != 0 || r != 0 {
		t.Errorf("keilor conserva %d sesiones y %d refresh tokens abiertos sin contrasena; "+
			"tenian que quedar revocados", s, r)
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

	if rol, demo := rolYDemo(t, pool, victor); rol != "user" || !demo {
		t.Errorf("victor quedo role=%q demo_login=%v; no debia tocarse", rol, demo)
	}
	if s, r := sesionesVigentes(t, pool, victor); s != 1 || r != 1 {
		t.Errorf("victor quedo con %d sesiones y %d refresh tokens vigentes; se esperaba 1 y 1", s, r)
	}
	if _, err := svc.Login(ctx, &auth.LoginRequest{Identifier: "victor", Password: ""}, emptyCtx); err != nil {
		t.Errorf("victor dejo de entrar sin contrasena: %v", err)
	}
}

// En una base sin la cuenta (desarrollo nuevo, CI) no hace nada ni aborta el
// arranque. Y correrla otra vez, con keilor ya administrador, no vuelve a cerrar
// sesiones: la que abrio con su contrasena despues de la primera sigue viva.
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
}
