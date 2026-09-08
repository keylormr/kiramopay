package transaction_test

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/kiramopay/backend/internal/ledger"
	"github.com/kiramopay/backend/internal/testutil"
	"github.com/kiramopay/backend/internal/transaction"
	"github.com/kiramopay/backend/internal/wallet"
	"github.com/kiramopay/backend/pkg/hash"
)

// Helper propio porque estas pruebas necesitan el pool para fijar los topes de
// la billetera, y el de la suite vieja no lo devuelve.
func conPool(t *testing.T) (*transaction.Service, *pgxpool.Pool, string) {
	t.Helper()
	pool := testutil.TestDB(t)
	l := ledger.NewEngine(pool, slog.New(slog.NewJSONHandler(os.Stdout, nil)))
	svc := transaction.NewService(transaction.NewRepository(pool), wallet.NewRepository(pool), l, nil)
	pinHash, _ := hash.HashPin("Kiramopay2024!")
	return svc, pool, testutil.SeedTestUser(t, pool, "702650930", pinHash)
}

// El tope MENSUAL existia en la base, lo calculaba KYC por nivel, se escribia al
// aprobar una verificacion y el perfil se lo mostraba a la persona como una
// promesa. No lo comparaba nadie.
//
// La prueba se arma como ocurre de verdad: gastar dentro del tope diario hasta
// pasar el mensual. Con el mensual sin comprobar, esto pasaba sin que nada lo
// frenara, y el numero que la aplicacion mostraba era una cifra sin efecto.
func TestTopeMensual_FrenaLoQueElDiarioDeja(t *testing.T) {
	svc, pool, userID := conPool(t)
	ctx := context.Background()

	// Tope diario holgado y mensual chico, para llegar al mensual en dos pasos
	// sin fabricar cientos de movimientos. Saldo de sobra, para que lo que frene
	// sea el tope y no el saldo.
	if _, err := pool.Exec(ctx,
		`UPDATE wallets SET balance_crc = 100000000000,
		        daily_limit = 100000000000, monthly_limit = 150000
		  WHERE user_id = $1::uuid`, userID); err != nil {
		t.Fatalf("preparar billetera: %v", err)
	}

	mover := func(monto int64, clave string) error {
		_, err := svc.CreateTransaction(ctx, userID, &transaction.CreateTransactionRequest{
			Type: transaction.TypeSinpeSend, Amount: monto, Currency: "CRC",
			IdempotencyKey: clave,
		})
		return err
	}

	if err := mover(100_000, "mensual-1"); err != nil {
		t.Fatalf("el primer movimiento deberia pasar: %v", err)
	}
	// 100.000 + 100.000 = 200.000 > 150.000 de tope mensual.
	err := mover(100_000, "mensual-2")
	if !errors.Is(err, transaction.ErrMonthlyLimitExceeded) {
		t.Fatalf("el segundo movimiento paso el tope mensual y no se freno: err = %v", err)
	}

	// Y lo que si cabe dentro del mes sigue pasando.
	if err := mover(50_000, "mensual-3"); err != nil {
		t.Fatalf("un movimiento que cabe en el tope mensual deberia pasar: %v", err)
	}
}

// Una moneda sin tope mensual definido no puede salir "sin tope": es el mismo
// agujero que el diario ya cerraba, con otro nombre.
func TestTopeMensual_MonedaSinTopeSeRechaza(t *testing.T) {
	svc, pool, userID := conPool(t)
	ctx := context.Background()

	if _, err := pool.Exec(ctx,
		`UPDATE wallets SET balance_crc = 100000000000, balance_usd = 100000000,
		        daily_limit = 100000000000, monthly_limit = 100000000000,
		        daily_limit_usd = 100000000, monthly_limit_usd = 100000000
		  WHERE user_id = $1::uuid`, userID); err != nil {
		t.Fatalf("preparar billetera: %v", err)
	}

	if err := svc.CheckLimits(ctx, userID, "EUR", 1_000); !errors.Is(err, transaction.ErrMonedaSinTope) {
		t.Fatalf("una moneda sin tope deberia rechazarse: err = %v", err)
	}
}
