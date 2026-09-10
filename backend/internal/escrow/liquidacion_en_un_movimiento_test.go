package escrow_test

import (
	"context"
	"log/slog"
	"os"
	"testing"

	"github.com/kiramopay/backend/internal/escrow"
	"github.com/kiramopay/backend/internal/ledger"
	"github.com/kiramopay/backend/internal/testutil"
	"github.com/kiramopay/backend/internal/transaction"
	"github.com/kiramopay/backend/internal/wallet"
)

// La liquidacion del escrow se escribe en UN movimiento: el estado, la marca de
// liquidacion y la fila del historial salen de la misma transaccion que el
// asiento.
//
// La transicion ya estaba adentro (la metio el #168). Las otras dos corrian
// DESPUES del COMMIT y con el error descartado, asi que un acuerdo podia quedar
// 'released' con settled_at en NULL —el estado diciendo una cosa y la marca de
// liquidacion otra, que es justo lo que sale por el webhook del comercio— y el
// movimiento podia no aparecer nunca en la lista del usuario.

func TestLiberarEscribeEstadoMarcaEHistorialJuntos(t *testing.T) {
	pool := testutil.TestDB(t)
	ctx := context.Background()

	buyer := testutil.SeedTestUser(t, pool, "702650930", "dummy")
	seller := testutil.SeedTestUser2(t, pool)

	logger := slog.New(slog.NewTextHandler(os.Stdout, nil))
	eng := ledger.NewEngine(pool, logger)
	// El historial va de verdad: es lo unico que prueba que la fila se escribe.
	txSvc := transaction.NewService(
		transaction.NewRepository(pool), wallet.NewRepository(pool), eng, nil)
	svc := escrow.NewService(escrow.NewRepository(pool), eng, &escrow.Options{
		MFA:     mfaDePrueba{desde: 100_000, verificado: true},
		History: txSvc,
	})
	fundWallet(t, eng, buyer, 1_000_000)

	a, err := svc.Create(ctx, buyer, &escrow.CreateRequest{
		SellerID: seller, AmountMinor: 250_000, Currency: "CRC", Description: "laptop",
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if _, err := svc.Fund(ctx, buyer, a.ID); err != nil {
		t.Fatalf("Fund: %v", err)
	}
	if _, err := svc.Release(ctx, buyer, a.ID); err != nil {
		t.Fatalf("Release: %v", err)
	}

	// 1. El estado y la marca de liquidacion no se contradicen.
	var estado string
	var liquidado *string
	if err := pool.QueryRow(ctx,
		`SELECT status, settled_at::text FROM escrow_agreements WHERE id = $1::uuid`,
		a.ID).Scan(&estado, &liquidado); err != nil {
		t.Fatalf("leer el acuerdo: %v", err)
	}
	if estado != "released" {
		t.Fatalf("estado = %q, se esperaba released", estado)
	}
	if liquidado == nil {
		t.Fatal("settled_at quedo en NULL sobre un acuerdo liberado: el estado y la marca se contradicen")
	}

	// 2. El movimiento aparece en la lista del vendedor, que es quien recibio.
	var movimientos int
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM transactions
		  WHERE user_id = $1::uuid AND type = 'escrow_receive' AND status = 'completed'`,
		seller).Scan(&movimientos); err != nil {
		t.Fatalf("contar movimientos: %v", err)
	}
	if movimientos != 1 {
		t.Fatalf("movimientos del vendedor = %d, se esperaba 1", movimientos)
	}

	// 3. Y el fondeo quedo anotado en la lista del comprador.
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM transactions
		  WHERE user_id = $1::uuid AND type = 'escrow_fund' AND status = 'completed'`,
		buyer).Scan(&movimientos); err != nil {
		t.Fatalf("contar movimientos del comprador: %v", err)
	}
	if movimientos != 1 {
		t.Fatalf("movimientos del comprador = %d, se esperaba 1", movimientos)
	}
}

// Repetir la liberacion es exito idempotente y NO duplica la fila del historial:
// el asiento ya existe, el gancho no vuelve a correr, y la reposicion de la rama
// de reparacion se apoya en la misma llave de idempotencia.
func TestLiberarDosVecesNoDuplicaElHistorial(t *testing.T) {
	pool := testutil.TestDB(t)
	ctx := context.Background()

	buyer := testutil.SeedTestUser(t, pool, "702650930", "dummy")
	seller := testutil.SeedTestUser2(t, pool)

	logger := slog.New(slog.NewTextHandler(os.Stdout, nil))
	eng := ledger.NewEngine(pool, logger)
	txSvc := transaction.NewService(
		transaction.NewRepository(pool), wallet.NewRepository(pool), eng, nil)
	svc := escrow.NewService(escrow.NewRepository(pool), eng, &escrow.Options{
		MFA:     mfaDePrueba{desde: 100_000, verificado: true},
		History: txSvc,
	})
	fundWallet(t, eng, buyer, 1_000_000)

	a, err := svc.Create(ctx, buyer, &escrow.CreateRequest{
		SellerID: seller, AmountMinor: 250_000, Currency: "CRC", Description: "laptop",
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if _, err := svc.Fund(ctx, buyer, a.ID); err != nil {
		t.Fatalf("Fund: %v", err)
	}
	if _, err := svc.Release(ctx, buyer, a.ID); err != nil {
		t.Fatalf("Release: %v", err)
	}
	saldoVendedor := walletCRC(t, pool, seller)

	if _, err := svc.Release(ctx, buyer, a.ID); err != nil {
		t.Fatalf("segunda Release: %v", err)
	}
	if got := walletCRC(t, pool, seller); got != saldoVendedor {
		t.Fatalf("saldo del vendedor = %d, se esperaba %d: se libero dos veces", got, saldoVendedor)
	}

	var movimientos int
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM transactions WHERE user_id = $1::uuid AND type = 'escrow_receive'`,
		seller).Scan(&movimientos); err != nil {
		t.Fatalf("contar movimientos: %v", err)
	}
	if movimientos != 1 {
		t.Fatalf("movimientos = %d, se esperaba 1", movimientos)
	}
}
