package escrow_test

import (
	"context"
	"testing"

	"github.com/kiramopay/backend/internal/escrow"
)

// El peor camino que tenia este modulo: un acuerdo en 'funded' cuyo asiento de
// fondeo nunca aterrizo. Nadie lo reparaba —el barrido solo miraba estados
// terminales— y liberarlo SI postea: debita SYSTEM:ESCROW, que no tiene piso, y
// acredita al vendedor dinero que ningun comprador pago.
//
// Desde que la transicion y el asiento se confirman juntos ese estado no puede
// nacer, pero las filas que quedaron asi antes siguen ahi. Esta prueba fabrica
// una y comprueba que el barrido la devuelve a 'pending' en vez de dejar que se
// convierta en plata.
func TestReparaFundeoSinAsiento(t *testing.T) {
	pool, svc, buyer, seller := setup(t)
	ctx := context.Background()

	a, err := svc.Create(ctx, buyer, &escrow.CreateRequest{
		SellerID: seller, AmountMinor: 300_000, Currency: "CRC", Description: "fondeo-fantasma",
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	// El estado que dejaba la ventana vieja: 'funded' con la marca de tiempo
	// puesta y sin un solo asiento. Se antedata para pasar la edad minima.
	if _, err := pool.Exec(ctx,
		`UPDATE escrow_agreements
		    SET status='funded', funded_at = NOW() - INTERVAL '1 hour'
		  WHERE id=$1::uuid`, a.ID); err != nil {
		t.Fatalf("fabricar el estado: %v", err)
	}

	compradorAntes := walletCRC(t, pool, buyer)
	vendedorAntes := walletCRC(t, pool, seller)
	escrowAntes := escrowAccountBalance(t, pool)

	if _, err := svc.ReconcileStuck(ctx, 10); err != nil {
		t.Fatalf("reconcile: %v", err)
	}

	var estado string
	if err := pool.QueryRow(ctx,
		`SELECT status FROM escrow_agreements WHERE id=$1::uuid`, a.ID).Scan(&estado); err != nil {
		t.Fatalf("leer estado: %v", err)
	}
	if estado != "pending" {
		t.Fatalf("el acuerdo quedo en %q, esperaba 'pending': un 'funded' sin asiento "+
			"es un acuerdo que NO esta fondeado, y liberarlo acuña dinero", estado)
	}

	// Y el barrido no puede haber movido un centimo al repararlo.
	if got := walletCRC(t, pool, buyer); got != compradorAntes {
		t.Fatalf("la billetera del comprador cambio: %d -> %d", compradorAntes, got)
	}
	if got := walletCRC(t, pool, seller); got != vendedorAntes {
		t.Fatalf("la billetera del vendedor cambio: %d -> %d", vendedorAntes, got)
	}
	if got := escrowAccountBalance(t, pool); got != escrowAntes {
		t.Fatalf("la cuenta de escrow cambio: %d -> %d", escrowAntes, got)
	}
}

// Un acuerdo fondeado DE VERDAD no lo toca el barrido: su asiento existe.
func TestNoTocaUnFondeoLegitimo(t *testing.T) {
	pool, svc, buyer, seller := setup(t)
	ctx := context.Background()

	a, err := svc.Create(ctx, buyer, &escrow.CreateRequest{
		SellerID: seller, AmountMinor: 250_000, Currency: "CRC", Description: "fondeo-real",
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if _, err := svc.Fund(ctx, buyer, a.ID); err != nil {
		t.Fatalf("fund: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`UPDATE escrow_agreements SET funded_at = NOW() - INTERVAL '1 hour' WHERE id=$1::uuid`,
		a.ID); err != nil {
		t.Fatalf("antedatar: %v", err)
	}

	if _, err := svc.ReconcileStuck(ctx, 10); err != nil {
		t.Fatalf("reconcile: %v", err)
	}

	var estado string
	if err := pool.QueryRow(ctx,
		`SELECT status FROM escrow_agreements WHERE id=$1::uuid`, a.ID).Scan(&estado); err != nil {
		t.Fatalf("leer estado: %v", err)
	}
	if estado != "funded" {
		t.Fatalf("el barrido desfondeo un acuerdo legitimo: quedo en %q", estado)
	}
	if got := escrowAccountBalance(t, pool); got != 250_000 {
		t.Fatalf("la cuenta de escrow quedo en %d, esperaba 250000", got)
	}
}

// Liberar dos veces mueve el dinero UNA vez, y reembolsar despues no paga.
//
// Son dos propiedades distintas y las dos importan:
//
//   - Repetir la MISMA accion es idempotente y responde exito. La llave del
//     asiento es determinista, asi que el segundo intento no postea nada.
//     (Esto cambio: antes devolvia 409, porque el reclamo del estado corria
//     primero y fallaba. Devolver el estado alcanzado es mejor para quien toca
//     dos veces el boton o para un reintento de red: la operacion si se hizo.)
//   - Una accion CONTRARIA se rechaza. Reembolsar usa otra llave de
//     idempotencia, asi que lo unico que lo frena es el estado. Cuando el
//     estado y el asiento no eran la misma transaccion, aca cobraban los dos.
func TestLiberarDosVecesMueveElDineroUnaVez(t *testing.T) {
	pool, svc, buyer, seller := setup(t)
	ctx := context.Background()

	a, err := svc.Create(ctx, buyer, &escrow.CreateRequest{
		SellerID: seller, AmountMinor: 120_000, Currency: "CRC", Description: "doble-liberacion",
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if _, err := svc.Fund(ctx, buyer, a.ID); err != nil {
		t.Fatalf("fund: %v", err)
	}
	vendedorAntes := walletCRC(t, pool, seller)

	if _, err := svc.Release(ctx, buyer, a.ID); err != nil {
		t.Fatalf("release: %v", err)
	}
	segunda, err := svc.Release(ctx, buyer, a.ID)
	if err != nil {
		t.Fatalf("repetir la misma liberacion deberia ser idempotente: %v", err)
	}
	if segunda.Status != "released" {
		t.Fatalf("la segunda liberacion devolvio estado %q", segunda.Status)
	}
	// Y el vendedor tiene que haber cobrado exactamente una vez.
	if got := walletCRC(t, pool, seller) - vendedorAntes; got != 120_000 {
		t.Fatalf("el vendedor cobro %d, esperaba 120000 exactos", got)
	}

	// Reembolsar despues tampoco puede pagar: usa OTRA llave de idempotencia, y
	// lo unico que lo frena es que el estado ya no sea 'funded'. Si esa guarda y
	// el asiento no fueran la misma transaccion, aca cobrarian los dos.
	compradorAntes := walletCRC(t, pool, buyer)
	if _, err := svc.Refund(ctx, seller, a.ID); err == nil {
		t.Fatal("reembolsar un acuerdo ya liberado deberia fallar")
	}
	if got := walletCRC(t, pool, buyer); got != compradorAntes {
		t.Fatalf("el comprador cobro un reembolso sobre un acuerdo ya liberado: %d -> %d",
			compradorAntes, got)
	}
	if got := escrowAccountBalance(t, pool); got != 0 {
		t.Fatalf("la cuenta de escrow quedo en %d, esperaba 0", got)
	}
}
