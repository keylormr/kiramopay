package testutil

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// PoolConZona devuelve OTRO pool contra la misma base de pruebas, con la zona
// horaria de la SESION fijada en zona (por ejemplo "America/Costa_Rica"). No
// crea el esquema ni trunca nada: de eso se encarga TestDB, igual que con
// PoolTrazado.
//
// Produccion corre en GMT y por eso un valor que se guarda con la zona de la
// sesion mal tratada no se nota ahi: el desfase es de cero horas. Una prueba que
// quiera cazar ese defecto tiene que correr su consulta en una sesion que NO
// sea UTC, y la zona va como parametro de arranque de la conexion para que
// valga en todas las del pool, no solo en la que tocara un SET suelto.
func PoolConZona(t *testing.T, zona string) *pgxpool.Pool {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	poolCfg := configDePrueba(t)
	poolCfg.ConnConfig.RuntimeParams["timezone"] = zona
	pool, err := pgxpool.NewWithConfig(ctx, poolCfg)
	if err != nil {
		t.Skipf("Skipping integration test: cannot connect to test DB: %v", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		t.Skipf("Skipping integration test: cannot ping test DB: %v", err)
	}
	t.Cleanup(pool.Close)

	// Si la base no conoce la zona, Postgres rechaza el arranque; si la acepta
	// pero la sesion quedo en otra, la prueba no probaria lo que dice.
	var efectiva string
	if err := pool.QueryRow(ctx, `SHOW TimeZone`).Scan(&efectiva); err != nil {
		t.Fatalf("leer la zona de la sesion: %v", err)
	}
	if efectiva != zona {
		t.Fatalf("la sesion quedo en la zona %q, se pidio %q", efectiva, zona)
	}
	return pool
}
