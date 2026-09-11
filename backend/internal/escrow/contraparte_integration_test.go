package escrow_test

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/kiramopay/backend/internal/escrow"
	"github.com/kiramopay/backend/internal/ledger"
	"github.com/kiramopay/backend/internal/testutil"
	"github.com/kiramopay/backend/internal/user"
)

// La pantalla pedia el UUID del vendedor con marcador
// "00000000-0000-0000-0000-000000000000" y ninguna pantalla de la aplicacion
// muestra el UUID de nadie: el producto era inalcanzable. Del otro lado, el
// servidor aceptaba cualquier UUID bien formado como vendedor, asi que se podia
// fondear un acuerdo hacia una cuenta inexistente: la plata salia de la
// billetera del comprador y no habia a quien liberarsela.

const (
	telefonoComprador = "+50688881234" // testutil.SeedTestUser
	telefonoVendedor  = "+50688885678" // testutil.SeedTestUser2
)

func conBuscador(t *testing.T) (*pgxpool.Pool, *escrow.Service, string, string) {
	t.Helper()
	pool := testutil.TestDB(t)
	comprador := testutil.SeedTestUser(t, pool, "702650930", "dummy")
	vendedor := testutil.SeedTestUser2(t, pool)

	logger := slog.New(slog.NewTextHandler(os.Stdout, nil))
	eng := ledger.NewEngine(pool, logger)
	svc := escrow.NewService(escrow.NewRepository(pool), eng, &escrow.Options{
		Cuentas: user.NewRepository(pool),
	})
	fundWallet(t, eng, comprador, 1_000_000)
	return pool, svc, comprador, vendedor
}

func cuantosAcuerdos(t *testing.T, pool *pgxpool.Pool) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM escrow_agreements`).Scan(&n); err != nil {
		t.Fatalf("contar acuerdos: %v", err)
	}
	return n
}

func TestElVendedorSeIdentificaPorTelefono(t *testing.T) {
	_, svc, comprador, vendedor := conBuscador(t)
	ctx := context.Background()

	a, err := svc.Create(ctx, comprador, &escrow.CreateRequest{
		SellerPhone: telefonoVendedor, AmountMinor: 150_000, Currency: "CRC", Description: "bicicleta",
	})
	if err != nil {
		t.Fatalf("Create por telefono: %v", err)
	}
	if a.SellerID != vendedor {
		t.Fatalf("vendedor = %s, se esperaba %s", a.SellerID, vendedor)
	}

	// Sin el prefijo del pais tambien: el telefono se canonicaliza.
	b, err := svc.Create(ctx, comprador, &escrow.CreateRequest{
		SellerPhone: "88885678", AmountMinor: 10_000, Currency: "CRC", Description: "otra cosa",
	})
	if err != nil {
		t.Fatalf("Create sin prefijo: %v", err)
	}
	if b.SellerID != vendedor {
		t.Fatalf("vendedor sin prefijo = %s, se esperaba %s", b.SellerID, vendedor)
	}
}

func TestNoSePuedeAbrirUnEscrowHaciaUnaCuentaQueNoExiste(t *testing.T) {
	pool, svc, comprador, _ := conBuscador(t)
	ctx := context.Background()
	antes := cuantosAcuerdos(t, pool)

	// Un telefono valido que no es de nadie.
	_, err := svc.Create(ctx, comprador, &escrow.CreateRequest{
		SellerPhone: "+50611112222", AmountMinor: 150_000, Currency: "CRC", Description: "humo",
	})
	if !errors.Is(err, escrow.ErrVendedorSinCuenta) {
		t.Fatalf("telefono sin cuenta: err = %v, se esperaba ErrVendedorSinCuenta", err)
	}

	// Un UUID bien formado que no es de nadie: ESTE es el agujero. Antes el
	// acuerdo se creaba, se podia fondear, y la plata quedaba retenida sin
	// destinatario posible.
	_, err = svc.Create(ctx, comprador, &escrow.CreateRequest{
		SellerID:    "11111111-2222-3333-4444-555555555555",
		AmountMinor: 150_000, Currency: "CRC", Description: "humo",
	})
	if !errors.Is(err, escrow.ErrVendedorSinCuenta) {
		t.Fatalf("uuid sin cuenta: err = %v, se esperaba ErrVendedorSinCuenta", err)
	}

	// Basura en el id no llega a la base como `$2::uuid`.
	_, err = svc.Create(ctx, comprador, &escrow.CreateRequest{
		SellerID: "no-soy-un-uuid", AmountMinor: 150_000, Currency: "CRC", Description: "humo",
	})
	if !errors.Is(err, escrow.ErrInvalidRequest) {
		t.Fatalf("id invalido: err = %v, se esperaba ErrInvalidRequest", err)
	}

	// Un telefono que no es un telefono.
	_, err = svc.Create(ctx, comprador, &escrow.CreateRequest{
		SellerPhone: "hola", AmountMinor: 150_000, Currency: "CRC", Description: "humo",
	})
	if !errors.Is(err, escrow.ErrInvalidRequest) {
		t.Fatalf("telefono invalido: err = %v, se esperaba ErrInvalidRequest", err)
	}

	// Y sin contraparte no hay acuerdo.
	_, err = svc.Create(ctx, comprador, &escrow.CreateRequest{
		AmountMinor: 150_000, Currency: "CRC", Description: "humo",
	})
	if !errors.Is(err, escrow.ErrInvalidRequest) {
		t.Fatalf("sin contraparte: err = %v, se esperaba ErrInvalidRequest", err)
	}

	if got := cuantosAcuerdos(t, pool); got != antes {
		t.Fatalf("se escribieron %d acuerdos rechazados: la resolucion tiene que ir ANTES de escribir", got-antes)
	}
}

// Un escrow con uno mismo es el patron de auto-trato que el tope diario ya
// intenta frenar; por telefono tambien se rechaza.
func TestNoSePuedeAbrirUnEscrowConUnoMismo(t *testing.T) {
	pool, svc, comprador, _ := conBuscador(t)
	ctx := context.Background()
	antes := cuantosAcuerdos(t, pool)

	_, err := svc.Create(ctx, comprador, &escrow.CreateRequest{
		SellerPhone: telefonoComprador, AmountMinor: 150_000, Currency: "CRC", Description: "yo conmigo",
	})
	if !errors.Is(err, escrow.ErrInvalidRequest) {
		t.Fatalf("escrow con uno mismo: err = %v, se esperaba ErrInvalidRequest", err)
	}
	if got := cuantosAcuerdos(t, pool); got != antes {
		t.Fatalf("se creo el acuerdo consigo mismo")
	}
}
