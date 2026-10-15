package notification_test

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/kiramopay/backend/internal/notification"
	"github.com/kiramopay/backend/internal/testutil"
)

// El aviso queda guardado en el historial, y sale por push, en el idioma que
// la cuenta tiene guardado (users.language, migracion 074).

func ultimoAviso(t *testing.T, pool *pgxpool.Pool, userID string) (titulo, cuerpo string) {
	t.Helper()
	if err := pool.QueryRow(context.Background(),
		`SELECT title, body FROM notification_history WHERE user_id = $1::uuid
		  ORDER BY created_at DESC LIMIT 1`, userID).Scan(&titulo, &cuerpo); err != nil {
		t.Fatalf("leer el aviso guardado: %v", err)
	}
	return titulo, cuerpo
}

func TestNotificarEnSuIdioma_UsaElIdiomaDeLaCuenta(t *testing.T) {
	pool := testutil.TestDB(t)
	uid := testutil.SeedTestUser(t, pool, "702650930", "dummy")
	if _, err := pool.Exec(context.Background(),
		`UPDATE users SET language = 'en' WHERE id = $1::uuid`, uid); err != nil {
		t.Fatalf("guardar el idioma: %v", err)
	}
	svc := notification.NewService(notification.NewRepository(pool), "", "")

	if err := svc.NotificarEnSuIdioma(context.Background(), uid, "sinpe_recibido",
		notification.Datos{"monto": "₡10,000.00"}, "transaction"); err != nil {
		t.Fatalf("avisar: %v", err)
	}
	titulo, cuerpo := ultimoAviso(t, pool, uid)
	if titulo != "SINPE received" || cuerpo != "You received ₡10,000.00 via SINPE Móvil" {
		t.Fatalf("el aviso quedo como %q / %q, se esperaba en ingles", titulo, cuerpo)
	}
}

// Una cuenta que nunca guardo su idioma (todas las de antes de la 074) sigue
// recibiendo el espanol de siempre.
func TestNotificarEnSuIdioma_SinIdiomaGuardadoSaleEnEspanol(t *testing.T) {
	pool := testutil.TestDB(t)
	uid := testutil.SeedTestUser(t, pool, "702650930", "dummy")
	svc := notification.NewService(notification.NewRepository(pool), "", "")

	if err := svc.NotificarEnSuIdioma(context.Background(), uid, "sinpe_recibido",
		notification.Datos{"monto": "₡10,000.00"}, "transaction"); err != nil {
		t.Fatalf("avisar: %v", err)
	}
	titulo, cuerpo := ultimoAviso(t, pool, uid)
	if titulo != "SINPE recibido" || cuerpo != "Recibiste ₡10,000.00 por SINPE Móvil" {
		t.Fatalf("el aviso quedo como %q / %q, se esperaba en espanol", titulo, cuerpo)
	}
}
