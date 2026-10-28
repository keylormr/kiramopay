package escrow_test

import (
	"context"
	"testing"

	"github.com/kiramopay/backend/internal/escrow"
	"github.com/kiramopay/backend/internal/testutil"
)

// La lista de acuerdos acota la pagina a 200. Pedir mas devolvia 50, el valor
// por defecto, en vez del tope (el mismo defecto que tenia el historial de
// movimientos).
func TestListByUser_PedirMasQueElTopeDevuelveElTope(t *testing.T) {
	pool := testutil.TestDB(t)
	comprador := testutil.SeedTestUser(t, pool, "702650930", "dummy")
	vendedor := testutil.SeedTestUser2(t, pool)
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO escrow_agreements (buyer_id, seller_id, amount_minor, description)
		 SELECT $1::uuid, $2::uuid, 1000, 'acuerdo ' || g
		   FROM generate_series(1, 205) g`, comprador, vendedor); err != nil {
		t.Fatalf("sembrar acuerdos: %v", err)
	}
	repo := escrow.NewRepository(pool)

	casos := []struct{ pedido, quiere int }{
		{500, 200}, // mas que el tope: el tope
		{201, 200},
		{200, 200},
		{10, 10},
		{0, 50}, // sin pedido: el valor por defecto
		{-1, 50},
	}
	for _, c := range casos {
		lista, err := repo.ListByUser(context.Background(), comprador, c.pedido)
		if err != nil {
			t.Fatalf("limit=%d: %v", c.pedido, err)
		}
		if len(lista) != c.quiere {
			t.Errorf("limit=%d: devolvio %d acuerdos, se esperaban %d", c.pedido, len(lista), c.quiere)
		}
	}
}
