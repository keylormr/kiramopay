package transaction_test

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/kiramopay/backend/internal/ledger"
	"github.com/kiramopay/backend/internal/transaction"
	"github.com/kiramopay/backend/internal/wallet"
)

// Dos guardas que no guardaban nada.
//
// El tope sumaba lo gastado con un SELECT suelto y decidia FUERA de la
// transaccion que despues consumia esa decision: dos salidas simultaneas leian
// la misma suma y las dos pasaban, asi que el tope valia el doble. Y el motor de
// riesgo solo era alcanzable por POST /fraud/assess: la restriccion que ponia el
// administrador no restringia nada.

func fijarTopes(t *testing.T, pool *pgxpool.Pool, userID string, diario, mensual int64) {
	t.Helper()
	if _, err := pool.Exec(context.Background(),
		`UPDATE wallets SET daily_limit = $2, monthly_limit = $3 WHERE user_id = $1::uuid`,
		userID, diario, mensual); err != nil {
		t.Fatalf("fijar topes: %v", err)
	}
}

func salida(monto int64, llave string) *transaction.CreateTransactionRequest {
	return &transaction.CreateTransactionRequest{
		Type: transaction.TypeCryptoBuy, Amount: monto, Currency: "CRC", IdempotencyKey: llave,
	}
}

// LA PRUEBA QUE IMPORTA. Dos salidas simultaneas que juntas se pasan del tope:
// una pasa y la otra no. Antes pasaban las dos.
func TestDosSalidasSimultaneasNoDuplicanElTope(t *testing.T) {
	svc, pool, userID := conPool(t)
	ctx := context.Background()

	const monto int64 = 60000
	// El tope deja pasar UNA sola de las dos.
	fijarTopes(t, pool, userID, 100000, 100000000)
	saldo0 := crcWallet(t, pool, userID)

	var wg sync.WaitGroup
	errs := make([]error, 2)
	for i := range errs {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_, errs[i] = svc.CreateTransaction(ctx, userID, salida(monto, "tope-carrera-"+string(rune('a'+i))))
		}(i)
	}
	wg.Wait()

	exitos, frenados := 0, 0
	for _, err := range errs {
		switch {
		case err == nil:
			exitos++
		case errors.Is(err, transaction.ErrDailyLimitExceeded):
			frenados++
		default:
			t.Fatalf("error inesperado: %v", err)
		}
	}
	if exitos != 1 || frenados != 1 {
		t.Fatalf("exitos=%d frenados=%d, se esperaba 1 y 1 (errs=%v)", exitos, frenados, errs)
	}
	if got, want := crcWallet(t, pool, userID), saldo0-monto; got != want {
		t.Fatalf("saldo = %d, se esperaba %d: salio mas plata que el tope", got, want)
	}
}

// Lo mismo con el tope MENSUAL, que es el que no comparaba nadie hasta hace
// poco: sin la suma adentro del asiento volveria a valer el doble.
func TestDosSalidasSimultaneasNoDuplicanElTopeMensual(t *testing.T) {
	svc, pool, userID := conPool(t)
	ctx := context.Background()

	const monto int64 = 60000
	fijarTopes(t, pool, userID, 100000000, 100000)
	saldo0 := crcWallet(t, pool, userID)

	var wg sync.WaitGroup
	errs := make([]error, 2)
	for i := range errs {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_, errs[i] = svc.CreateTransaction(ctx, userID, salida(monto, "mensual-carrera-"+string(rune('a'+i))))
		}(i)
	}
	wg.Wait()

	exitos := 0
	for _, err := range errs {
		if err == nil {
			exitos++
		} else if !errors.Is(err, transaction.ErrMonthlyLimitExceeded) {
			t.Fatalf("error inesperado: %v", err)
		}
	}
	if exitos != 1 {
		t.Fatalf("exitos=%d, se esperaba 1 (errs=%v)", exitos, errs)
	}
	if got, want := crcWallet(t, pool, userID), saldo0-monto; got != want {
		t.Fatalf("saldo = %d, se esperaba %d", got, want)
	}
}

// Una salida que cabe holgada sigue pasando: el tope no puede convertirse en un
// freno para todos.
func TestUnaSalidaDentroDelTopePasa(t *testing.T) {
	svc, pool, userID := conPool(t)
	ctx := context.Background()

	fijarTopes(t, pool, userID, 100000000, 100000000)
	saldo0 := crcWallet(t, pool, userID)

	if _, err := svc.CreateTransaction(ctx, userID, salida(50000, "dentro-del-tope")); err != nil {
		t.Fatalf("CreateTransaction: %v", err)
	}
	if got, want := crcWallet(t, pool, userID), saldo0-50000; got != want {
		t.Fatalf("saldo = %d, se esperaba %d", got, want)
	}
}

// ── El motor de riesgo ─────────────────────────────────────────────────────

type riesgoQueBloquea struct{ llamado bool }

func (r *riesgoQueBloquea) EvaluarSalida(context.Context, string, string, string, int64, string) (string, error) {
	r.llamado = true
	return "block", nil
}

type riesgoQueFalla struct{}

func (riesgoQueFalla) EvaluarSalida(context.Context, string, string, string, int64, string) (string, error) {
	// El motor de puntaje fallo. EvaluarSalida ya decidio que eso NO frena un
	// pago legitimo: devuelve "allow" con el error para que quede registrado.
	return "allow", errors.New("la base de riesgo no responde")
}

func conRiesgo(t *testing.T, pool *pgxpool.Pool, r transaction.RiskAssessor) *transaction.Service {
	t.Helper()
	return transaction.NewService(
		transaction.NewRepository(pool), wallet.NewRepository(pool),
		ledger.NewEngine(pool, slog.New(slog.NewJSONHandler(io.Discard, nil))),
		&transaction.Options{Risk: r, Logger: slog.New(slog.NewJSONHandler(io.Discard, nil))},
	)
}

// El motor de riesgo ahora se ejecuta EN el camino del dinero, y cuando dice
// que no, no sale un centimo. Antes nadie lo llamaba: la cuenta que el
// administrador habia restringido seguia moviendo plata.
func TestElMotorDeRiesgoFrenaLaSalida(t *testing.T) {
	_, pool, userID := conPool(t)
	ctx := context.Background()
	motor := &riesgoQueBloquea{}
	svc := conRiesgo(t, pool, motor)

	saldo0 := crcWallet(t, pool, userID)
	_, err := svc.CreateTransaction(ctx, userID, salida(50000, "riesgo-bloquea"))
	if !errors.Is(err, transaction.ErrBloqueadoPorRiesgo) {
		t.Fatalf("error = %v, se esperaba ErrBloqueadoPorRiesgo", err)
	}
	if !motor.llamado {
		t.Fatal("el motor de riesgo no se consulto")
	}
	if got := crcWallet(t, pool, userID); got != saldo0 {
		t.Fatalf("saldo = %d, se esperaba %d: se movio plata en una salida bloqueada", got, saldo0)
	}
	// Y no queda una fila de un movimiento que nunca se intento mover.
	var n int
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM transactions WHERE idempotency_key = 'riesgo-bloquea'`).Scan(&n); err != nil {
		t.Fatalf("contar filas: %v", err)
	}
	if n != 0 {
		t.Fatalf("filas = %d, se esperaba 0", n)
	}
}

// Un fallo del MOTOR no puede frenar un pago legitimo: el puntaje es una
// heuristica, no una garantia de saldo. Lo que si frena es la restriccion
// administrativa, y esa se lee aparte.
func TestUnFalloDelMotorNoFrenaElPago(t *testing.T) {
	_, pool, userID := conPool(t)
	ctx := context.Background()
	svc := conRiesgo(t, pool, riesgoQueFalla{})

	saldo0 := crcWallet(t, pool, userID)
	if _, err := svc.CreateTransaction(ctx, userID, salida(40000, "riesgo-falla")); err != nil {
		t.Fatalf("CreateTransaction: %v", err)
	}
	if got, want := crcWallet(t, pool, userID), saldo0-40000; got != want {
		t.Fatalf("saldo = %d, se esperaba %d", got, want)
	}
}

// Sin motor configurado, todo sigue igual que antes.
func TestSinMotorDeRiesgoLaSalidaPasa(t *testing.T) {
	svc, pool, userID := conPool(t)
	ctx := context.Background()

	saldo0 := crcWallet(t, pool, userID)
	if _, err := svc.CreateTransaction(ctx, userID, salida(30000, "sin-motor")); err != nil {
		t.Fatalf("CreateTransaction: %v", err)
	}
	if got, want := crcWallet(t, pool, userID), saldo0-30000; got != want {
		t.Fatalf("saldo = %d, se esperaba %d", got, want)
	}
}
