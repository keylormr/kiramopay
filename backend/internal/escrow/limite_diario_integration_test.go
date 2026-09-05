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
	"github.com/kiramopay/backend/internal/transaction"
	"github.com/kiramopay/backend/internal/wallet"
)

// EL AGUJERO QUE ESTO CIERRA: escrow.Fund comprobaba el saldo pero NINGUN tope
// diario, a diferencia de transaction.CreateTransfer. Cualquier usuario podia
// vaciar su billetera creando acuerdos hacia una cuenta que el mismo controla,
// en tramos por debajo del umbral que pide segundo factor, y liberandolos.
//
// Sin el arreglo las dos pruebas de este archivo fallan: la primera porque el
// tercer acuerdo se financia igual, y la segunda porque el gasto por escrow no
// aparece en el acumulado del dia.

// conTope arma el servicio de escrow con el de transacciones detras (que es
// como se cablea en produccion, cmd/api/main.go) y fija el tope diario del
// comprador.
func conTope(t *testing.T, topeDiario int64) (*pgxpool.Pool, *escrow.Service, *transaction.Service, string, string) {
	t.Helper()
	pool := testutil.TestDB(t)
	comprador := testutil.SeedTestUser(t, pool, "702650930", "dummy")
	vendedor := testutil.SeedTestUser2(t, pool)

	logger := slog.New(slog.NewTextHandler(os.Stdout, nil))
	eng := ledger.NewEngine(pool, logger)
	txSvc := transaction.NewService(
		transaction.NewRepository(pool), wallet.NewRepository(pool), eng, &transaction.Options{})
	svc := escrow.NewService(escrow.NewRepository(pool), eng, &escrow.Options{History: txSvc})

	fundWallet(t, eng, comprador, 10_000_000) // 100.000,00 CRC: saldo de sobra
	if _, err := pool.Exec(context.Background(),
		`UPDATE wallets SET daily_limit = $2 WHERE user_id = $1::uuid`, comprador, topeDiario); err != nil {
		t.Fatalf("fijar tope diario: %v", err)
	}
	return pool, svc, txSvc, comprador, vendedor
}

func financiar(t *testing.T, svc *escrow.Service, comprador, vendedor string, monto int64) error {
	t.Helper()
	ctx := context.Background()
	a, err := svc.Create(ctx, comprador, &escrow.CreateRequest{
		SellerID: vendedor, AmountMinor: monto, Currency: "CRC", Description: "cosa",
	})
	if err != nil {
		t.Fatalf("crear acuerdo: %v", err)
	}
	_, err = svc.Fund(ctx, comprador, a.ID)
	return err
}

// El tope se cuenta SUMANDO los acuerdos del dia, no acuerdo por acuerdo: si se
// mirara solo el monto individual, bastaria con partir el gasto en tramos.
func TestFund_ElTopeDiarioSeCuentaSumandoLosAcuerdosDelDia(t *testing.T) {
	_, svc, _, comprador, vendedor := conTope(t, 100_000) // 1.000,00 CRC al dia

	if err := financiar(t, svc, comprador, vendedor, 40_000); err != nil {
		t.Fatalf("primer acuerdo (400,00): %v", err)
	}
	if err := financiar(t, svc, comprador, vendedor, 40_000); err != nil {
		t.Fatalf("segundo acuerdo (400,00, acumulado 800,00): %v", err)
	}
	// El tercero llevaria el dia a 1.200,00 y el tope es 1.000,00. Hay saldo de
	// sobra: lo que frena aqui es el tope, no el saldo.
	err := financiar(t, svc, comprador, vendedor, 40_000)
	if !errors.Is(err, escrow.ErrDailyLimitExceeded) {
		t.Fatalf("tercer acuerdo = %v, esperaba ErrDailyLimitExceeded", err)
	}
}

// Y el gasto por escrow tiene que CONTAR para el tope de los demas caminos. Sin
// esto, alguien gastaba su tope entero por escrow y despues transferia el tope
// completo otra vez por SINPE: el tope diario valdria el doble de lo que dice.
func TestFund_ElGastoPorEscrowCuentaParaElTopeDeLosDemasCaminos(t *testing.T) {
	_, svc, txSvc, comprador, vendedor := conTope(t, 100_000)

	if err := financiar(t, svc, comprador, vendedor, 90_000); err != nil {
		t.Fatalf("financiar 900,00: %v", err)
	}

	// Ahora el mismo usuario intenta sacar 200,00 por el camino de las
	// transferencias. El dia va en 900,00 de 1.000,00: no le alcanza.
	err := txSvc.CheckDailyLimit(context.Background(), comprador, "CRC", 20_000)
	if !errors.Is(err, transaction.ErrDailyLimitExceeded) {
		t.Fatalf("el acumulado del dia no incluye lo gastado por escrow: %v", err)
	}

	// Y lo que si cabe en lo que queda, pasa.
	if err := txSvc.CheckDailyLimit(context.Background(), comprador, "CRC", 5_000); err != nil {
		t.Fatalf("un monto que si cabe fue rechazado: %v", err)
	}
}

// Sin tope configurado (0) no se frena nada: es el caso de las billeteras
// creadas antes de que existieran los limites por nivel de KYC.
func TestFund_SinTopeConfiguradoNoSeFrena(t *testing.T) {
	_, svc, _, comprador, vendedor := conTope(t, 0)

	for i := 0; i < 3; i++ {
		if err := financiar(t, svc, comprador, vendedor, 500_000); err != nil {
			t.Fatalf("acuerdo %d con tope 0: %v", i+1, err)
		}
	}
}
