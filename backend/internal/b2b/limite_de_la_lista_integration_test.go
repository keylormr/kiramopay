package b2b_test

import (
	"context"
	"testing"

	"github.com/kiramopay/backend/internal/b2b"
	"github.com/kiramopay/backend/internal/testutil"
)

// Las entregas recientes de un webhook acotan la pagina a 100. Pedir mas
// devolvia 25, el valor por defecto, en vez del tope (el mismo defecto que
// tenia el historial de movimientos).
func TestRecentDeliveries_PedirMasQueElTopeDevuelveElTope(t *testing.T) {
	pool := testutil.TestDB(t)
	ctx := context.Background()
	userID := testutil.SeedTestUser(t, pool, "702650930", "dummy")
	var endpointID string
	if err := pool.QueryRow(ctx,
		`INSERT INTO webhook_endpoints (user_id, url, secret) VALUES ($1::uuid, 'https://ejemplo.test/hook', 's')
		 RETURNING id::text`, userID).Scan(&endpointID); err != nil {
		t.Fatalf("sembrar el webhook: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO webhook_deliveries (endpoint_id, event_type, payload, created_at)
		 SELECT $1::uuid, 'prueba', '{}'::jsonb, NOW() - (g || ' seconds')::interval
		   FROM generate_series(1, 105) g`, endpointID); err != nil {
		t.Fatalf("sembrar entregas: %v", err)
	}
	repo := b2b.NewRepository(pool)

	casos := []struct{ pedido, quiere int }{
		{500, 100}, // mas que el tope: el tope
		{101, 100},
		{100, 100},
		{10, 10},
		{0, 25}, // sin pedido: el valor por defecto
		{-1, 25},
	}
	for _, c := range casos {
		lista, err := repo.RecentDeliveries(ctx, userID, endpointID, c.pedido)
		if err != nil {
			t.Fatalf("limit=%d: %v", c.pedido, err)
		}
		if len(lista) != c.quiere {
			t.Errorf("limit=%d: devolvio %d entregas, se esperaban %d", c.pedido, len(lista), c.quiere)
		}
	}
}
