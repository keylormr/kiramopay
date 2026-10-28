package payout

import (
	"context"
	"testing"

	"github.com/kiramopay/backend/internal/testutil"
)

// La lista de retiros acota la pagina a 200. Pedir mas devolvia 50, el valor
// por defecto, en vez del tope (el mismo defecto que tenia el historial de
// movimientos).
func TestListByUser_PedirMasQueElTopeDevuelveElTope(t *testing.T) {
	pool := testutil.TestDB(t)
	userID := testutil.SeedTestUser(t, pool, "702650930", "dummy")
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO payouts (user_id, rail, amount_minor, destination, idempotency_key)
		 SELECT $1::uuid, 'sinpe', 1000, '{}'::jsonb, 'limite-' || g
		   FROM generate_series(1, 205) g`, userID); err != nil {
		t.Fatalf("sembrar retiros: %v", err)
	}
	repo := NewRepository(pool)

	casos := []struct{ pedido, quiere int }{
		{500, 200}, // mas que el tope: el tope
		{201, 200},
		{200, 200},
		{10, 10},
		{0, 50}, // sin pedido: el valor por defecto
		{-1, 50},
	}
	for _, c := range casos {
		lista, err := repo.ListByUser(context.Background(), userID, c.pedido)
		if err != nil {
			t.Fatalf("limit=%d: %v", c.pedido, err)
		}
		if len(lista) != c.quiere {
			t.Errorf("limit=%d: devolvio %d retiros, se esperaban %d", c.pedido, len(lista), c.quiere)
		}
	}
}
