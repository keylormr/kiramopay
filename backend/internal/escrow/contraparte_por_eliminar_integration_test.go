package escrow_test

import (
	"context"
	"errors"
	"testing"

	"github.com/kiramopay/backend/internal/escrow"
)

// Un acuerdo con vendedor que pidio eliminar su cuenta no se abre. Sin esto
// cualquiera que conozca su telefono podria abrirle un acuerdo pendiente, que no
// vence y que solo el comprador cancela, y con eso impedir el cierre del dia 30.
func TestNoSePuedeAbrirUnEscrowHaciaUnaCuentaPorEliminar(t *testing.T) {
	pool, svc, comprador, vendedor := conBuscador(t)
	ctx := context.Background()
	if _, err := pool.Exec(ctx, `UPDATE users
		SET status = 'pending_deletion', deletion_requested_at = NOW(),
		    deletion_due_at = NOW() + interval '30 days', deletion_terms_accepted_at = NOW(),
		    deletion_channel = 'in_app'
		WHERE id = $1::uuid`, vendedor); err != nil {
		t.Fatalf("marcar por eliminar: %v", err)
	}
	antes := cuantosAcuerdos(t, pool)

	if _, err := svc.Create(ctx, comprador, &escrow.CreateRequest{
		SellerPhone: telefonoVendedor, AmountMinor: 10_000, Currency: "CRC", Description: "bicicleta",
	}); !errors.Is(err, escrow.ErrVendedorSinCuenta) {
		t.Fatalf("por telefono: err = %v, se esperaba ErrVendedorSinCuenta", err)
	}
	if _, err := svc.Create(ctx, comprador, &escrow.CreateRequest{
		SellerID: vendedor, AmountMinor: 10_000, Currency: "CRC", Description: "bicicleta",
	}); !errors.Is(err, escrow.ErrVendedorSinCuenta) {
		t.Fatalf("por id: err = %v, se esperaba ErrVendedorSinCuenta", err)
	}
	if n := cuantosAcuerdos(t, pool); n != antes {
		t.Fatalf("se abrieron %d acuerdos", n-antes)
	}
}
