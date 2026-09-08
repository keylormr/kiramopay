package escrow_test

import (
	"context"
	"testing"
	"time"

	"github.com/kiramopay/backend/internal/escrow"
)

// TestEscrowReconcileStuck simulates a release whose status claim advanced but
// whose ledger posting (and compensating revert) never landed — funds stuck in
// SYSTEM:ESCROW — and verifies the poller re-drives it to completion.
func TestEscrowReconcileStuck(t *testing.T) {
	pool, svc, buyer, seller := setup(t)
	ctx := context.Background()

	a, err := svc.Create(ctx, buyer, &escrow.CreateRequest{
		SellerID: seller, AmountMinor: 200_000, Currency: "CRC", Description: "stuck-release",
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if _, err := svc.Fund(ctx, buyer, a.ID); err != nil {
		t.Fatalf("fund: %v", err)
	}
	if got := escrowAccountBalance(t, pool); got != 200_000 {
		t.Fatalf("escrow account after fund = %d, want 200000", got)
	}

	// Antes de tocar nada: fondear NO puede haber dejado settled_at puesto.
	//
	// Esta prueba ponia `settled_at=NULL` a mano al forzar el estado atascado, y
	// por eso pasaba mientras el barrido real no podia encontrar nada: fondear
	// estampaba settled_at, y ListUnsettledTerminal filtra por settled_at IS
	// NULL. La prueba fabricaba la unica condicion que en produccion nunca se
	// daba. Ahora se comprueba, en vez de fabricarse.
	var settledTrasFondear *time.Time
	if err := pool.QueryRow(ctx,
		`SELECT settled_at FROM escrow_agreements WHERE id=$1::uuid`, a.ID).Scan(&settledTrasFondear); err != nil {
		t.Fatalf("leer settled_at tras fondear: %v", err)
	}
	if settledTrasFondear != nil {
		t.Fatal("fondear dejo settled_at puesto: con eso el barrido no puede ver JAMAS " +
			"un release o un refund atascado, porque filtra por settled_at IS NULL")
	}

	// Estado atascado: 'released' sin asiento de liberacion. Es lo que dejaba la
	// ventana de postear-y-compensar. settled_at no se toca a proposito.
	if _, err := pool.Exec(ctx,
		`UPDATE escrow_agreements SET status='released', released_at=NOW() WHERE id=$1::uuid`,
		a.ID); err != nil {
		t.Fatalf("force stuck: %v", err)
	}

	sellerBefore := walletCRC(t, pool, seller)

	healed, err := svc.ReconcileStuck(ctx, 10)
	if err != nil {
		t.Fatalf("reconcile: %v", err)
	}
	if healed != 1 {
		t.Fatalf("healed = %d, want 1", healed)
	}
	if got := walletCRC(t, pool, seller) - sellerBefore; got != 200_000 {
		t.Errorf("seller credited %d, want 200000", got)
	}
	if got := escrowAccountBalance(t, pool); got != 0 {
		t.Errorf("escrow account after reconcile = %d, want 0", got)
	}

	var settled *time.Time
	if err := pool.QueryRow(ctx,
		`SELECT settled_at FROM escrow_agreements WHERE id=$1::uuid`, a.ID).Scan(&settled); err != nil {
		t.Fatalf("read settled_at: %v", err)
	}
	if settled == nil {
		t.Error("settled_at should be set after reconcile")
	}

	// A second pass is a no-op (already settled, and re-posting is idempotent).
	if again, _ := svc.ReconcileStuck(ctx, 10); again != 0 {
		t.Errorf("second reconcile healed %d, want 0", again)
	}
}
