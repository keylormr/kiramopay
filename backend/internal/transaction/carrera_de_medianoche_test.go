package transaction_test

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/kiramopay/backend/internal/testutil"
	"github.com/kiramopay/backend/internal/transaction"
)

// La carrera que abre no reusar la fila de otro dia (ver soloDeHoy). El
// intento A abrio su fila ayer y seguia en vuelo —esperando el candado de la
// billetera, reintentando un conflicto— cuando el reintento B, ya hoy, la
// encontro sin asiento, la dejo fallida y abrio la suya. Si A gana el asiento,
// el dinero se movio una vez y fue este mismo movimiento: B contesta con la
// fila de A como repeticion, y la suya no queda 'pending' para siempre. B
// contestaba un error, y la fila de B quedaba pendiente sin asiento.
//
// Las pruebas frenan a A y a B despues de abrir cada uno su fila, corren la de
// A al dia anterior, y sueltan primero a A.

// filaDeLaLlave es la unica fila de esa persona bajo esa llave.
func filaDeLaLlave(t *testing.T, pool *pgxpool.Pool, userID, llave string) string {
	t.Helper()
	var id string
	if err := pool.QueryRow(context.Background(),
		`SELECT id FROM transactions WHERE user_id = $1::uuid AND idempotency_key = $2`,
		userID, llave).Scan(&id); err != nil {
		t.Fatalf("la fila de %s: %v", llave, err)
	}
	return id
}

// laOtraFila es la fila de esa persona bajo esa llave que no es `conocida`.
func laOtraFila(t *testing.T, pool *pgxpool.Pool, userID, llave, conocida string) string {
	t.Helper()
	var id string
	if err := pool.QueryRow(context.Background(),
		`SELECT id FROM transactions
		  WHERE user_id = $1::uuid AND idempotency_key = $2 AND id <> $3::uuid`,
		userID, llave, conocida).Scan(&id); err != nil {
		t.Fatalf("la otra fila de %s: %v", llave, err)
	}
	return id
}

func TestOperacion_SiElIntentoDeAyerGanaElAsientoElDeHoyEsSuRepeticion(t *testing.T) {
	_, pool, userID := conPool(t)
	billeteraHolgada(t, pool, userID)
	const llave = "medianoche:operacion"
	const monto int64 = 30000
	frenoA, frenoB := nuevoFreno(true), nuevoFreno(true)
	a := servicioSobre(testutil.PoolTrazado(t, frenoA))
	b := servicioSobre(testutil.PoolTrazado(t, frenoB))
	saldo := crcWallet(t, pool, userID)

	ra := lanzar(a, userID, compraDe(monto, llave))
	esperarCanal(t, frenoA.llego, "que A abra su fila")
	filaA := filaDeLaLlave(t, pool, userID, llave)
	alDiaAnterior(t, pool, filaA)

	rb := lanzar(b, userID, compraDe(monto, llave))
	esperarCanal(t, frenoB.llego, "que B abra la suya")
	filaB := laOtraFila(t, pool, userID, llave, filaA)

	close(frenoA.soltar)
	esperarCanal(t, ra.listo, "que A termine")
	if ra.err != nil || ra.repetido || ra.rec.ID != filaA {
		t.Fatalf("A: %v repetido=%v err=%v, se esperaba su fila %s", ra.rec, ra.repetido, ra.err, filaA)
	}
	close(frenoB.soltar)
	esperarCanal(t, rb.listo, "que B termine")

	if rb.err != nil {
		t.Fatalf("B: %v; el dinero se movio una vez, con A, y era este mismo movimiento", rb.err)
	}
	if !rb.repetido || rb.rec.ID != filaA {
		t.Fatalf("B contesto %s repetido=%v, se esperaba la fila de A %s como repeticion", rb.rec.ID, rb.repetido, filaA)
	}
	if got := estadoDeFila(t, pool, filaB); got != transaction.StatusFailed {
		t.Fatalf("la fila de B quedo %q, se esperaba %q", got, transaction.StatusFailed)
	}
	if n := asientosConLlave(t, pool, llave); n != 1 {
		t.Fatalf("asientos con la llave = %d, se esperaba 1", n)
	}
	if got, want := crcWallet(t, pool, userID), saldo-monto; got != want {
		t.Fatalf("saldo = %d, se esperaba %d", got, want)
	}
}

type transferenciaConRepeticion struct {
	emisor, receptor *transaction.TransactionRecord
	repetido         bool
	err              error
	listo            chan struct{}
}

func transferirEnVuelo(svc *transaction.Service, req *transaction.CreateTransferRequest) *transferenciaConRepeticion {
	r := &transferenciaConRepeticion{listo: make(chan struct{})}
	go func() {
		defer close(r.listo)
		r.emisor, r.receptor, r.repetido, r.err = svc.TransferirOReconocer(context.Background(), req)
	}()
	return r
}

func TestTransferencia_SiElIntentoDeAyerGanaElAsientoElDeHoyEsSuRepeticion(t *testing.T) {
	_, pool, emisor, receptor := setupTransferService(t)
	billeteraHolgada(t, pool, emisor)
	const llave = "medianoche:transferencia"
	const monto int64 = 30000
	frenoA, frenoB := nuevoFreno(true), nuevoFreno(true)
	a := servicioSobre(testutil.PoolTrazado(t, frenoA))
	b := servicioSobre(testutil.PoolTrazado(t, frenoB))
	saldo := crcWallet(t, pool, emisor)

	ra := transferirEnVuelo(a, transferencia(emisor, receptor, monto, llave))
	esperarCanal(t, frenoA.llego, "que A abra la fila de quien envia")
	envioA := filaDeLaLlave(t, pool, emisor, llave)
	alDiaAnterior(t, pool, envioA)

	rb := transferirEnVuelo(b, transferencia(emisor, receptor, monto, llave))
	esperarCanal(t, frenoB.llego, "que B abra la suya")
	envioB := laOtraFila(t, pool, emisor, llave, envioA)

	close(frenoA.soltar)
	esperarCanal(t, ra.listo, "que A termine")
	if ra.err != nil || ra.repetido || ra.emisor.ID != envioA || ra.receptor == nil {
		t.Fatalf("A: %v repetido=%v err=%v, se esperaba su fila %s", ra.emisor, ra.repetido, ra.err, envioA)
	}
	close(frenoB.soltar)
	esperarCanal(t, rb.listo, "que B termine")

	if rb.err != nil {
		t.Fatalf("B: %v; el dinero se movio una vez, con A, y era esta misma transferencia", rb.err)
	}
	if !rb.repetido || rb.emisor.ID != envioA {
		t.Fatalf("B contesto %s repetido=%v, se esperaba el envio de A %s como repeticion", rb.emisor.ID, rb.repetido, envioA)
	}
	if rb.receptor == nil || rb.receptor.ID != ra.receptor.ID {
		t.Fatalf("B contesto lo recibido %v, se esperaba lo de A %s", rb.receptor, ra.receptor.ID)
	}
	if got := estadoDeFila(t, pool, envioB); got != transaction.StatusFailed {
		t.Fatalf("el envio de B quedo %q, se esperaba %q", got, transaction.StatusFailed)
	}
	if n := asientosConLlave(t, pool, llave); n != 1 {
		t.Fatalf("asientos con la llave = %d, se esperaba 1", n)
	}
	if got, want := crcWallet(t, pool, emisor), saldo-monto; got != want {
		t.Fatalf("saldo = %d, se esperaba %d", got, want)
	}
}

type retiroConRepeticion struct {
	rec      *transaction.TransactionRecord
	repetido bool
	err      error
	listo    chan struct{}
}

func retirarEnVuelo(svc *transaction.Service, comercio, dueno string, monto int64, llave string) *retiroConRepeticion {
	r := &retiroConRepeticion{listo: make(chan struct{})}
	go func() {
		defer close(r.listo)
		r.rec, r.repetido, r.err = svc.WithdrawMerchantToUser(context.Background(), comercio, "Tienda", dueno, "CRC", monto, llave)
	}()
	return r
}

func TestRetiro_SiElIntentoDeAyerGanaElAsientoElDeHoyEsSuRepeticion(t *testing.T) {
	svc, pool, pagador, dueno := setupTransferService(t)
	comercio := uuid.New().String()
	cobrarAlComercio(t, svc, pagador, comercio, 200000)
	const llave = "medianoche:retiro"
	const monto int64 = 120000
	frenoA, frenoB := nuevoFreno(true), nuevoFreno(true)
	a := servicioSobre(testutil.PoolTrazado(t, frenoA))
	b := servicioSobre(testutil.PoolTrazado(t, frenoB))

	ra := retirarEnVuelo(a, comercio, dueno, monto, llave)
	esperarCanal(t, frenoA.llego, "que A abra su fila")
	filaA := filaDeLaLlave(t, pool, dueno, llave)
	alDiaAnterior(t, pool, filaA)

	rb := retirarEnVuelo(b, comercio, dueno, monto, llave)
	esperarCanal(t, frenoB.llego, "que B abra la suya")
	filaB := laOtraFila(t, pool, dueno, llave, filaA)

	close(frenoA.soltar)
	esperarCanal(t, ra.listo, "que A termine")
	if ra.err != nil || ra.repetido || ra.rec.ID != filaA {
		t.Fatalf("A: %v repetido=%v err=%v, se esperaba su fila %s", ra.rec, ra.repetido, ra.err, filaA)
	}
	close(frenoB.soltar)
	esperarCanal(t, rb.listo, "que B termine")

	if rb.err != nil {
		t.Fatalf("B: %v; el retiro salio una vez, con A, y era este mismo retiro", rb.err)
	}
	if !rb.repetido || rb.rec.ID != filaA {
		t.Fatalf("B contesto %s repetido=%v, se esperaba la fila de A %s como repeticion", rb.rec.ID, rb.repetido, filaA)
	}
	if got := estadoDeFila(t, pool, filaB); got != transaction.StatusFailed {
		t.Fatalf("la fila de B quedo %q, se esperaba %q", got, transaction.StatusFailed)
	}
	if n := asientosConLlave(t, pool, llave); n != 1 {
		t.Fatalf("asientos con la llave = %d, se esperaba 1", n)
	}
	if got, want := saldoDelComercio(t, svc, comercio), int64(200000-monto); got != want {
		t.Fatalf("saldo del comercio = %d, se esperaba %d", got, want)
	}
}
