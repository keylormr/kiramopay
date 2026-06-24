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

	// Force the stuck state: status='released' but no release posting and
	// settled_at NULL (what a Post-fails-then-revert-fails window leaves behind).
	if _, err := pool.Exec(ctx,
		`UPDATE escrow_agreements SET status='released', released_at=NOW(), settled_at=NULL WHERE id=$1::uuid`,
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
