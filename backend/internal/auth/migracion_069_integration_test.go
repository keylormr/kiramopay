package auth_test

import (
	"context"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/kiramopay/backend/internal/auth"
	"github.com/kiramopay/backend/internal/testutil"
)

// La migracion 069 se prueba ejecutando SU PROPIO archivo: el esquema de
// pruebas no lee migrations/, y una copia del SQL aca podria divergir de la que
// corre en produccion.
func correr069(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	sql, err := os.ReadFile("../../migrations/069_cuentas_demo_sin_contrasena.sql")
	if err != nil {
		t.Fatalf("leer migracion: %v", err)
	}
	if _, err := pool.Exec(context.Background(), string(sql)); err != nil {
		t.Fatalf("correr migracion: %v", err)
	}
}

func insertarCuenta(t *testing.T, pool *pgxpool.Pool, id, cedula, telefono, rol string, username *string) {
	t.Helper()
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO users (id, cedula_enc, cedula_hash, phone_enc, phone_hash, first_name, last_name,
		                    password_hash, status, kyc_level, role, username)
		 VALUES ($1::uuid, fn_pii_encrypt($2), fn_pii_hmac($2), fn_pii_encrypt($3), fn_pii_hmac($3),
		         'Cuenta', 'Demo', 'hash-que-nadie-conoce', 'active', 1, $4, $5)`,
		id, cedula, telefono, rol, username); err != nil {
		t.Fatalf("insertar cuenta %s: %v", cedula, err)
	}
}

func estadoDemo(t *testing.T, pool *pgxpool.Pool, id string) (bool, string) {
	t.Helper()
	var demo bool
	var username *string
	if err := pool.QueryRow(context.Background(),
		`SELECT demo_login, username FROM users WHERE id = $1::uuid`, id).Scan(&demo, &username); err != nil {
		t.Fatalf("leer cuenta: %v", err)
	}
	if username == nil {
		return demo, ""
	}
	return demo, *username
}

// Lo que pidio el dueno: las cuentas de demostracion para terceros entran sin
// contrasena, por nombre de usuario o por cedula.
func TestMigracion069_LasCuentasDemoEntranSinContrasena(t *testing.T) {
	svc, pool, _ := servicioConDemo(t, true)
	ana := "00000000-0000-0000-0000-0000000069a1"
	insertarCuenta(t, pool, ana, "111111111", "+50660000001", "user", nil)

	correr069(t, pool)

	demo, username := estadoDemo(t, pool, ana)
	if !demo || username != "ana" {
		t.Fatalf("Ana Demo quedo demo_login=%v username=%q; se esperaba true y \"ana\"", demo, username)
	}
	for _, identificador := range []string{"ana", "111111111"} {
		res, err := svc.Login(context.Background(), &auth.LoginRequest{Identifier: identificador, Password: ""}, emptyCtx)
		if err != nil {
			t.Fatalf("entrar con %q sin contrasena: %v", identificador, err)
		}
		if res.Tokens.AccessToken == "" {
			t.Fatalf("entrar con %q no emitio sesion", identificador)
		}
	}
}

// Una cuenta de administrador con una de esas cedulas no se toca, y la
// migracion no aborta (el CHECK chk_users_demo_login_no_admin haria fallar el
// arranque con RUN_MIGRATIONS=true). Un nombre de usuario ya tomado se respeta.
// Correrla dos veces da el mismo resultado.
func TestMigracion069_NoTocaAdministradoresNiNombresTomadosYEsIdempotente(t *testing.T) {
	pool := testutil.TestDB(t)
	admin := "00000000-0000-0000-0000-0000000069b1"
	carla := "00000000-0000-0000-0000-0000000069b2"
	otro := "00000000-0000-0000-0000-0000000069b3"
	tomado := "carla"
	insertarCuenta(t, pool, admin, "222222222", "+50660000002", "admin", nil)
	insertarCuenta(t, pool, otro, "909090909", "+50660000009", "user", &tomado)
	insertarCuenta(t, pool, carla, "333333333", "+50660000003", "user", nil)

	correr069(t, pool)
	correr069(t, pool)

	if demo, username := estadoDemo(t, pool, admin); demo || username != "" {
		t.Fatalf("la cuenta administradora quedo demo_login=%v username=%q; no debia tocarse", demo, username)
	}
	demo, username := estadoDemo(t, pool, carla)
	if !demo {
		t.Fatal("Carla Demo debia quedar marcada aunque su nombre de usuario ya estuviera tomado")
	}
	if username != "" {
		t.Fatalf("Carla Demo recibio el nombre %q que ya era de otra cuenta", username)
	}
	if demo, username := estadoDemo(t, pool, otro); demo || username != "carla" {
		t.Fatalf("la cuenta que ya tenia \"carla\" quedo demo_login=%v username=%q", demo, username)
	}
}
