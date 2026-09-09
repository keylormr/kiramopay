package transaction_test

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"strings"
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/kiramopay/backend/internal/ledger"
	"github.com/kiramopay/backend/internal/transaction"
	"github.com/kiramopay/backend/internal/wallet"
)

// Estas pruebas cubren la regla de la que dependen todas las demas de este
// paquete: una fila de `transactions` esta 'completed' si y solo si su asiento
// confirmo. El estado se escribe DENTRO de la transaccion del asiento, y por eso
// —y solo por eso— la relectura de idempotencia puede fiarse de el.
//
// El orden importa: hacer la relectura consciente del estado ANTES de mover el
// UPDATE adentro de la transaccion convierte un UPDATE perdido en un DOBLE
// COBRO. La prueba que vigila eso es TestUpdatePerdidoNoEsDobleCobro.

func estadoDeFila(t *testing.T, pool *pgxpool.Pool, id string) string {
	t.Helper()
	var estado string
	if err := pool.QueryRow(context.Background(),
		`SELECT status FROM transactions WHERE id = $1`, id).Scan(&estado); err != nil {
		t.Fatalf("leer estado de %s: %v", id, err)
	}
	return estado
}

func forzarEstado(t *testing.T, pool *pgxpool.Pool, id, estado string) {
	t.Helper()
	if _, err := pool.Exec(context.Background(),
		`UPDATE transactions SET status = $2 WHERE id = $1`, id, estado); err != nil {
		t.Fatalf("forzar estado %s: %v", estado, err)
	}
}

func idDeBilletera(t *testing.T, pool *pgxpool.Pool, userID string) string {
	t.Helper()
	var id string
	if err := pool.QueryRow(context.Background(),
		`SELECT id::text FROM wallets WHERE user_id = $1::uuid`, userID).Scan(&id); err != nil {
		t.Fatalf("leer billetera: %v", err)
	}
	return id
}

// insertarFilaCruda escribe una fila SIN asiento: es el estado en el que queda
// un intento que se cayo antes de mover el dinero.
func insertarFilaCruda(t *testing.T, pool *pgxpool.Pool, userID, tipo, moneda, llave, estado string, monto int64) string {
	t.Helper()
	id := uuid.New().String()
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO transactions
		   (id, wallet_id, user_id, type, amount, currency, fee, status, metadata,
		    idempotency_key, created_at, created_date)
		 VALUES ($1, $2, $3, $4, $5, $6, 0, $7, '{}'::jsonb, $8, NOW(), CURRENT_DATE)`,
		id, idDeBilletera(t, pool, userID), userID, tipo, monto, moneda, estado, llave,
	); err != nil {
		t.Fatalf("insertar fila cruda: %v", err)
	}
	return id
}

func asientosConLlave(t *testing.T, pool *pgxpool.Pool, llave string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM journal_postings WHERE idempotency_key = $1`, llave).Scan(&n); err != nil {
		t.Fatalf("contar asientos: %v", err)
	}
	return n
}

// Lo que fallaba: el UPDATE a 'completed' corria DESPUES de Post y por fuera de
// su transaccion. Si se perdia, la fila se quedaba en 'pending' para siempre con
// el dinero ya movido — invisible para el tope de gasto y para la vigilancia.
func TestElEstadoSeEscribeConElDinero(t *testing.T) {
	svc, pool, userID := conPool(t)
	ctx := context.Background()

	tx, err := svc.CreateTransaction(ctx, userID, &transaction.CreateTransactionRequest{
		Type: transaction.TypeCryptoBuy, Amount: 50000, Currency: "CRC",
		IdempotencyKey: "estado:1",
	})
	if err != nil {
		t.Fatalf("CreateTransaction: %v", err)
	}
	if got := estadoDeFila(t, pool, tx.ID); got != transaction.StatusCompleted {
		t.Fatalf("estado en la base = %q, se esperaba %q", got, transaction.StatusCompleted)
	}
	// Y lo que se devuelve dice lo mismo que la base: la fila que arma el
	// repositorio nace 'pending' y ese rotulo salia tal cual al cliente.
	if tx.Status != transaction.StatusCompleted {
		t.Fatalf("estado devuelto = %q, se esperaba %q", tx.Status, transaction.StatusCompleted)
	}
}

// Lo que fallaba: la relectura devolvia la fila sin mirar su estado, asi que un
// intento FALLIDO se reportaba como exito. El dinero nunca se movia y nadie
// volvia a intentarlo: el cobro quedaba perdido para siempre.
func TestFilaFallidaSeReintentaYMueveElDinero(t *testing.T) {
	svc, pool, userID := conPool(t)
	ctx := context.Background()
	const llave = "reintento:fallida"
	const monto int64 = 75000

	insertarFilaCruda(t, pool, userID, transaction.TypeCryptoBuy, "CRC", llave, transaction.StatusFailed, monto)
	saldo0 := crcWallet(t, pool, userID)

	tx, err := svc.CreateTransaction(ctx, userID, &transaction.CreateTransactionRequest{
		Type: transaction.TypeCryptoBuy, Amount: monto, Currency: "CRC", IdempotencyKey: llave,
	})
	if err != nil {
		t.Fatalf("CreateTransaction: %v", err)
	}
	if got, want := crcWallet(t, pool, userID), saldo0-monto; got != want {
		t.Fatalf("saldo = %d, se esperaba %d: el reintento no movio el dinero", got, want)
	}
	if got := estadoDeFila(t, pool, tx.ID); got != transaction.StatusCompleted {
		t.Fatalf("estado = %q, se esperaba %q", got, transaction.StatusCompleted)
	}
	if n := asientosConLlave(t, pool, llave); n != 1 {
		t.Fatalf("asientos con la llave = %d, se esperaba 1", n)
	}
}

// LA PRUEBA QUE VIGILA EL ORDEN DEL ARREGLO. Simula lo unico que el arreglo
// podia empeorar: una fila que se quedo sin marcar aunque el asiento SI
// confirmo. Si la relectura se fiara del estado sin que el estado viviera dentro
// de la transaccion del asiento, este reintento cobraria por segunda vez.
func TestUpdatePerdidoNoEsDobleCobro(t *testing.T) {
	svc, pool, userID := conPool(t)
	ctx := context.Background()
	const llave = "reintento:update-perdido"
	const monto int64 = 60000

	primera, err := svc.CreateTransaction(ctx, userID, &transaction.CreateTransactionRequest{
		Type: transaction.TypeCryptoBuy, Amount: monto, Currency: "CRC", IdempotencyKey: llave,
	})
	if err != nil {
		t.Fatalf("primera CreateTransaction: %v", err)
	}
	// El dinero ya se movio; se borra la marca, que es justo lo que pasaba
	// cuando el UPDATE corria por fuera y se perdia.
	forzarEstado(t, pool, primera.ID, transaction.StatusPending)
	saldoTrasLaPrimera := crcWallet(t, pool, userID)

	segunda, err := svc.CreateTransaction(ctx, userID, &transaction.CreateTransactionRequest{
		Type: transaction.TypeCryptoBuy, Amount: monto, Currency: "CRC", IdempotencyKey: llave,
	})
	if err != nil {
		t.Fatalf("segunda CreateTransaction: %v", err)
	}
	if got := crcWallet(t, pool, userID); got != saldoTrasLaPrimera {
		t.Fatalf("saldo = %d, se esperaba %d: se cobro dos veces", got, saldoTrasLaPrimera)
	}
	if segunda.ID != primera.ID {
		t.Fatalf("se creo una fila nueva (%s) en vez de recuperar la de siempre (%s)", segunda.ID, primera.ID)
	}
	if n := asientosConLlave(t, pool, llave); n != 1 {
		t.Fatalf("asientos con la llave = %d, se esperaba 1", n)
	}
	// Y la fila queda reparada, no a medias.
	if got := estadoDeFila(t, pool, primera.ID); got != transaction.StatusCompleted {
		t.Fatalf("estado = %q, se esperaba %q", got, transaction.StatusCompleted)
	}
}

// mfaSiempreExigido es la reja de segundo factor en el peor momento posible:
// exige verificacion y no hay ninguna vigente, que es lo normal en un reintento
// —el desafio de la primera vez ya se consumio—.
type mfaSiempreExigido struct{}

func (mfaSiempreExigido) IsMFARequired(int64, string) bool { return true }
func (mfaSiempreExigido) HasVerifiedMFA(context.Context, string, string) (bool, error) {
	return false, nil
}

// La reparacion de una fila sin marcar NO vuelve a pasar por las rejas de un
// movimiento nuevo. Si lo hiciera, el dinero que ya salio quedaria para siempre
// con la fila rota y al usuario se le diria que su pago no paso.
func TestFilaSinMarcarSeReparaSinPedirSegundoFactor(t *testing.T) {
	svc, pool, userID := conPool(t)
	ctx := context.Background()
	const llave = "reparacion:sin-mfa"
	const monto int64 = 70000

	primera, err := svc.CreateTransaction(ctx, userID, &transaction.CreateTransactionRequest{
		Type: transaction.TypeCryptoBuy, Amount: monto, Currency: "CRC", IdempotencyKey: llave,
	})
	if err != nil {
		t.Fatalf("primera CreateTransaction: %v", err)
	}
	forzarEstado(t, pool, primera.ID, transaction.StatusPending)

	conReja := transaction.NewService(
		transaction.NewRepository(pool), wallet.NewRepository(pool),
		ledger.NewEngine(pool, slog.New(slog.NewJSONHandler(io.Discard, nil))),
		&transaction.Options{MFA: mfaSiempreExigido{}},
	)
	segunda, err := conReja.CreateTransaction(ctx, userID, &transaction.CreateTransactionRequest{
		Type: transaction.TypeCryptoBuy, Amount: monto, Currency: "CRC", IdempotencyKey: llave,
	})
	if err != nil {
		t.Fatalf("la reparacion se freno: %v", err)
	}
	if segunda.ID != primera.ID || segunda.Status != transaction.StatusCompleted {
		t.Fatalf("reparacion devolvio %s/%s, se esperaba %s/completed", segunda.ID, segunda.Status, primera.ID)
	}
}

func TestRepeticionDeMovimientoCompletadoNoCobraDosVeces(t *testing.T) {
	svc, pool, userID := conPool(t)
	ctx := context.Background()
	const llave = "repeticion:1"
	const monto int64 = 40000

	if _, err := svc.CreateTransaction(ctx, userID, &transaction.CreateTransactionRequest{
		Type: transaction.TypeCryptoBuy, Amount: monto, Currency: "CRC", IdempotencyKey: llave,
	}); err != nil {
		t.Fatalf("primera: %v", err)
	}
	saldo1 := crcWallet(t, pool, userID)
	if _, err := svc.CreateTransaction(ctx, userID, &transaction.CreateTransactionRequest{
		Type: transaction.TypeCryptoBuy, Amount: monto, Currency: "CRC", IdempotencyKey: llave,
	}); err != nil {
		t.Fatalf("segunda: %v", err)
	}
	if got := crcWallet(t, pool, userID); got != saldo1 {
		t.Fatalf("saldo = %d, se esperaba %d: la repeticion volvio a cobrar", got, saldo1)
	}
}

// Una llave repetida tiene que describir el MISMO movimiento. Con otro monto no
// es un reintento: cripto calculaba la cantidad de activo con el monto NUEVO y
// el libro solo tenia anotado el viejo.
func TestLlaveReutilizadaConOtroMontoSeRechaza(t *testing.T) {
	svc, _, userID := conPool(t)
	ctx := context.Background()
	const llave = "reutilizada:1"

	if _, err := svc.CreateTransaction(ctx, userID, &transaction.CreateTransactionRequest{
		Type: transaction.TypeCryptoBuy, Amount: 30000, Currency: "CRC", IdempotencyKey: llave,
	}); err != nil {
		t.Fatalf("primera: %v", err)
	}
	_, err := svc.CreateTransaction(ctx, userID, &transaction.CreateTransactionRequest{
		Type: transaction.TypeCryptoBuy, Amount: 90000, Currency: "CRC", IdempotencyKey: llave,
	})
	if !errors.Is(err, transaction.ErrLlaveReutilizada) {
		t.Fatalf("error = %v, se esperaba ErrLlaveReutilizada", err)
	}
}

// Dos intentos a la vez con la misma llave: uno mueve el dinero y el otro se
// entera, pero el cobro ocurre UNA vez.
func TestDosIntentosSimultaneosCobranUnaVez(t *testing.T) {
	svc, pool, userID := conPool(t)
	ctx := context.Background()
	const llave = "simultaneo:1"
	const monto int64 = 25000

	saldo0 := crcWallet(t, pool, userID)
	var wg sync.WaitGroup
	errs := make([]error, 2)
	for i := range errs {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_, errs[i] = svc.CreateTransaction(ctx, userID, &transaction.CreateTransactionRequest{
				Type: transaction.TypeCryptoBuy, Amount: monto, Currency: "CRC", IdempotencyKey: llave,
			})
		}(i)
	}
	wg.Wait()
	for i, err := range errs {
		if err != nil {
			t.Fatalf("intento %d: %v", i, err)
		}
	}
	if got, want := crcWallet(t, pool, userID), saldo0-monto; got != want {
		t.Fatalf("saldo = %d, se esperaba %d: se cobro mas de una vez", got, want)
	}
	if n := asientosConLlave(t, pool, llave); n != 1 {
		t.Fatalf("asientos con la llave = %d, se esperaba 1", n)
	}
}

// --- CreateTransfer: las mismas dos reglas, con las dos filas ---

func TestTransferenciaEscribeLosDosEstadosConElDinero(t *testing.T) {
	svc, pool, emisor, receptor := setupTransferService(t)
	ctx := context.Background()

	env, rec, err := svc.CreateTransfer(ctx, &transaction.CreateTransferRequest{
		FromUserID: emisor, ToUserID: receptor, Amount: 80000, Currency: "CRC",
		IdempotencyKey: "transfer:estado:1",
		TxType:         transaction.TypeP2PSend, ReceiveType: transaction.TypeP2PReceive,
	})
	if err != nil {
		t.Fatalf("CreateTransfer: %v", err)
	}
	for _, r := range []*transaction.TransactionRecord{env, rec} {
		if got := estadoDeFila(t, pool, r.ID); got != transaction.StatusCompleted {
			t.Fatalf("estado de %s = %q, se esperaba %q", r.ID, got, transaction.StatusCompleted)
		}
		if r.Status != transaction.StatusCompleted {
			t.Fatalf("estado devuelto de %s = %q", r.ID, r.Status)
		}
	}
}

func TestTransferenciaFallidaSeReintenta(t *testing.T) {
	svc, pool, emisor, receptor := setupTransferService(t)
	ctx := context.Background()
	const llave = "transfer:fallida"
	const monto int64 = 55000

	insertarFilaCruda(t, pool, emisor, transaction.TypeP2PSend, "CRC", llave, transaction.StatusFailed, monto)
	saldo0 := crcWallet(t, pool, emisor)
	recibido0 := crcWallet(t, pool, receptor)

	if _, _, err := svc.CreateTransfer(ctx, &transaction.CreateTransferRequest{
		FromUserID: emisor, ToUserID: receptor, Amount: monto, Currency: "CRC",
		IdempotencyKey: llave,
		TxType:         transaction.TypeP2PSend, ReceiveType: transaction.TypeP2PReceive,
	}); err != nil {
		t.Fatalf("CreateTransfer: %v", err)
	}
	if got, want := crcWallet(t, pool, emisor), saldo0-monto; got != want {
		t.Fatalf("saldo del emisor = %d, se esperaba %d", got, want)
	}
	if got, want := crcWallet(t, pool, receptor), recibido0+monto; got != want {
		t.Fatalf("saldo del receptor = %d, se esperaba %d", got, want)
	}
}

func TestTransferenciaConUpdatePerdidoNoCobraDosVeces(t *testing.T) {
	svc, pool, emisor, receptor := setupTransferService(t)
	ctx := context.Background()
	const llave = "transfer:update-perdido"
	const monto int64 = 45000

	env, rec, err := svc.CreateTransfer(ctx, &transaction.CreateTransferRequest{
		FromUserID: emisor, ToUserID: receptor, Amount: monto, Currency: "CRC",
		IdempotencyKey: llave,
		TxType:         transaction.TypeP2PSend, ReceiveType: transaction.TypeP2PReceive,
	})
	if err != nil {
		t.Fatalf("primera CreateTransfer: %v", err)
	}
	forzarEstado(t, pool, env.ID, transaction.StatusPending)
	forzarEstado(t, pool, rec.ID, transaction.StatusPending)
	saldo1 := crcWallet(t, pool, emisor)

	if _, _, err := svc.CreateTransfer(ctx, &transaction.CreateTransferRequest{
		FromUserID: emisor, ToUserID: receptor, Amount: monto, Currency: "CRC",
		IdempotencyKey: llave,
		TxType:         transaction.TypeP2PSend, ReceiveType: transaction.TypeP2PReceive,
	}); err != nil {
		t.Fatalf("segunda CreateTransfer: %v", err)
	}
	if got := crcWallet(t, pool, emisor); got != saldo1 {
		t.Fatalf("saldo = %d, se esperaba %d: se cobro dos veces", got, saldo1)
	}
	if got := estadoDeFila(t, pool, rec.ID); got != transaction.StatusCompleted {
		t.Fatalf("la fila del receptor quedo en %q", got)
	}
}

// El gancho del llamante es lo que T3 necesita para reclamar el codigo QR de un
// solo uso dentro del mismo movimiento que el dinero. Si lo que quiere reclamar
// ya no esta, el dinero NO se mueve.
func TestGanchoDelLlamanteAbortaElDinero(t *testing.T) {
	svc, pool, emisor, receptor := setupTransferService(t)
	ctx := context.Background()
	saldo0 := crcWallet(t, pool, emisor)
	seLlamo := false

	_, _, err := svc.CreateTransfer(ctx, &transaction.CreateTransferRequest{
		FromUserID: emisor, ToUserID: receptor, Amount: 35000, Currency: "CRC",
		IdempotencyKey: "transfer:gancho-aborta",
		TxType:         transaction.TypeQRPayment, ReceiveType: transaction.TypeQRReceive,
		EnLaMismaTx: func(context.Context, pgx.Tx) error {
			seLlamo = true
			return errors.New("ese codigo ya se cobro")
		},
	})
	if err == nil {
		t.Fatal("se esperaba error: el gancho rechazo el movimiento")
	}
	if !seLlamo {
		t.Fatal("el gancho del llamante no se ejecuto")
	}
	if !strings.Contains(err.Error(), "ese codigo ya se cobro") {
		t.Fatalf("el motivo del llamante no llego al error: %v", err)
	}
	if got := crcWallet(t, pool, emisor); got != saldo0 {
		t.Fatalf("saldo = %d, se esperaba %d: el dinero se movio pese al rechazo", got, saldo0)
	}
}

// El tercer sitio del mismo defecto, el que la lista no nombraba: un retiro del
// saldo del negocio que fallo, devuelto como exito, deja la plata adentro y al
// dueno convencido de que la saco.
func TestRetiroDeNegocioFallidoSeReintenta(t *testing.T) {
	svc, pool, emisor, dueno := setupTransferService(t)
	ctx := context.Background()
	comercio := uuid.New().String()
	const cobrado int64 = 200000
	const retiro int64 = 120000

	// Se le cobra al comercio para que tenga saldo propio.
	if _, _, err := svc.CreateTransfer(ctx, &transaction.CreateTransferRequest{
		FromUserID: emisor, ToMerchantID: comercio, Amount: cobrado, Currency: "CRC",
		IdempotencyKey: "comercio:cobro:1",
		TxType:         transaction.TypeQRPayment, ReceiveType: transaction.TypeQRReceive,
	}); err != nil {
		t.Fatalf("cobro al comercio: %v", err)
	}

	const llave = "mwithdraw:reintento"
	insertarFilaCruda(t, pool, dueno, transaction.TypeMerchantWithdrawal, "CRC", llave, transaction.StatusFailed, retiro)
	saldo0 := crcWallet(t, pool, dueno)

	rec, err := svc.WithdrawMerchantToUser(ctx, comercio, "Tienda", dueno, "CRC", retiro, llave)
	if err != nil {
		t.Fatalf("WithdrawMerchantToUser: %v", err)
	}
	if got, want := crcWallet(t, pool, dueno), saldo0+retiro; got != want {
		t.Fatalf("saldo del dueno = %d, se esperaba %d: el reintento no movio el dinero", got, want)
	}
	if got := estadoDeFila(t, pool, rec.ID); got != transaction.StatusCompleted {
		t.Fatalf("estado = %q, se esperaba %q", got, transaction.StatusCompleted)
	}
}
