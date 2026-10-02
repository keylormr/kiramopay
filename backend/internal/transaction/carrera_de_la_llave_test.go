package transaction_test

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/kiramopay/backend/internal/ledger"
	"github.com/kiramopay/backend/internal/testutil"
	"github.com/kiramopay/backend/internal/transaction"
	"github.com/kiramopay/backend/internal/wallet"
)

// Las carreras con la misma llave, frenadas a mano en el punto exacto.
//
// Dos pedidos con la misma llave que llegan a la vez pasan los dos la
// relectura sin encontrar fila, y el que inserta segundo recibe ErrDuplicate
// con la fila del otro. Lo que haga con esa fila es lo que fijan estas pruebas.
// Sueltas, las goroutines casi nunca caen en ese hueco —el que llega tarde
// suele esperar el candado de la billetera y salir por el asiento repetido—,
// asi que aqui se lo provoca: el pool de cada pedido frena su INSERT hasta que
// el otro avanzo lo que la prueba necesita.

// frenoDeInsercion detiene una sola vez la insercion de la fila del
// movimiento: al empezar (la fila todavia no existe) o al terminar (la fila ya
// esta confirmada: el INSERT va solo y confirma solo).
type frenoDeInsercion struct {
	alTerminar bool
	llego      chan struct{}
	soltar     chan struct{}
	unaVez     sync.Once
}

func nuevoFreno(alTerminar bool) *frenoDeInsercion {
	return &frenoDeInsercion{alTerminar: alTerminar, llego: make(chan struct{}), soltar: make(chan struct{})}
}

// sqlDelTrazado lleva el texto de la consulta del inicio al final del
// trazado: pgx solo lo entrega en TraceQueryStart.
type sqlDelTrazado struct{}

func (f *frenoDeInsercion) TraceQueryStart(ctx context.Context, _ *pgx.Conn, d pgx.TraceQueryStartData) context.Context {
	if !f.alTerminar {
		f.frenar(d.SQL)
	}
	return context.WithValue(ctx, sqlDelTrazado{}, d.SQL)
}

func (f *frenoDeInsercion) TraceQueryEnd(ctx context.Context, _ *pgx.Conn, _ pgx.TraceQueryEndData) {
	if f.alTerminar {
		sql, _ := ctx.Value(sqlDelTrazado{}).(string)
		f.frenar(sql)
	}
}

func (f *frenoDeInsercion) frenar(sql string) {
	if !strings.Contains(sql, "INSERT INTO transactions") {
		return
	}
	f.unaVez.Do(func() {
		close(f.llego)
		// Con tope: una espera sin fin dejaria colgado el truncado del cierre.
		select {
		case <-f.soltar:
		case <-time.After(15 * time.Second):
		}
	})
}

func servicioSobre(pool *pgxpool.Pool) *transaction.Service {
	l := ledger.NewEngine(pool, slog.New(slog.NewTextHandler(io.Discard, nil)))
	return transaction.NewService(transaction.NewRepository(pool), wallet.NewRepository(pool), l, nil)
}

func compraDe(monto int64, llave string) *transaction.CreateTransactionRequest {
	return &transaction.CreateTransactionRequest{
		Type: transaction.TypeCryptoBuy, Amount: monto, Currency: "CRC", IdempotencyKey: llave,
	}
}

// Saldo y topes de sobra: lo que estas pruebas miden es la llave, y un rechazo
// por saldo o por tope taparia la respuesta.
func billeteraHolgada(t *testing.T, pool *pgxpool.Pool, userID string) {
	t.Helper()
	if _, err := pool.Exec(context.Background(),
		`UPDATE wallets SET balance_crc = 100000000,
		        daily_limit = 100000000000, monthly_limit = 100000000000
		  WHERE user_id = $1::uuid`, userID); err != nil {
		t.Fatalf("preparar billetera: %v", err)
	}
}

func esperarCanal(t *testing.T, c <-chan struct{}, que string) {
	t.Helper()
	select {
	case <-c:
	case <-time.After(15 * time.Second):
		t.Fatalf("se agoto la espera de: %s", que)
	}
}

type resultado struct {
	rec      *transaction.TransactionRecord
	repetido bool
	err      error
	listo    chan struct{}
}

func lanzar(svc *transaction.Service, userID string, req *transaction.CreateTransactionRequest) *resultado {
	r := &resultado{listo: make(chan struct{})}
	go func() {
		defer close(r.listo)
		r.rec, r.repetido, r.err = svc.CrearOReconocer(context.Background(), userID, req)
	}()
	return r
}

// El mismo cobro, y el que llega tarde a insertar encuentra la fila del otro
// ya completada: es la repeticion de algo hecho, con su id y sin cobrar.
func TestCrearOReconocer_ElQueInsertaTardeSobreUnCobroHechoEsRepeticion(t *testing.T) {
	svc, pool, userID := conPool(t)
	billeteraHolgada(t, pool, userID)
	freno := nuevoFreno(false)
	tarde := servicioSobre(testutil.PoolTrazado(t, freno))
	const llave = "carrera:tarde-mismo-cobro"
	saldo := crcWallet(t, pool, userID)

	segundo := lanzar(tarde, userID, compraDe(30000, llave))
	esperarCanal(t, freno.llego, "que el segundo llegue a insertar su fila")
	primero, repetido, err := svc.CrearOReconocer(context.Background(), userID, compraDe(30000, llave))
	if err != nil || repetido {
		t.Fatalf("el primer cobro: repetido=%v err=%v", repetido, err)
	}
	close(freno.soltar)
	esperarCanal(t, segundo.listo, "que el segundo termine")

	if segundo.err != nil {
		t.Fatalf("el segundo: %v", segundo.err)
	}
	if !segundo.repetido {
		t.Fatal("el segundo encontro el cobro hecho y se informo como cobro nuevo")
	}
	if segundo.rec.ID != primero.ID {
		t.Fatalf("el segundo devolvio %s, el cobro fue %s", segundo.rec.ID, primero.ID)
	}
	if got, want := crcWallet(t, pool, userID), saldo-30000; got != want {
		t.Fatalf("saldo = %d, se esperaba %d", got, want)
	}
}

// Otro monto con la misma llave, y la fila del primero ya completada: no es la
// repeticion de nada, es otra operacion que pide prestada una llave usada. Se
// rechaza igual que en la relectura; devolver el cobro del primero seria
// contestarle "ya estaba hecho" por una operacion que nunca se hizo.
func TestCrearOReconocer_OtroMontoConLaLlaveDeUnCobroHechoSeRechaza(t *testing.T) {
	svc, pool, userID := conPool(t)
	billeteraHolgada(t, pool, userID)
	freno := nuevoFreno(false)
	tarde := servicioSobre(testutil.PoolTrazado(t, freno))
	const llave = "carrera:tarde-otro-monto"
	saldo := crcWallet(t, pool, userID)

	otro := lanzar(tarde, userID, compraDe(50000, llave))
	esperarCanal(t, freno.llego, "que el segundo llegue a insertar su fila")
	if _, _, err := svc.CrearOReconocer(context.Background(), userID, compraDe(30000, llave)); err != nil {
		t.Fatalf("el primer cobro: %v", err)
	}
	close(freno.soltar)
	esperarCanal(t, otro.listo, "que el segundo termine")

	if !errors.Is(otro.err, transaction.ErrLlaveReutilizada) {
		t.Fatalf("el segundo: repetido=%v err=%v, se esperaba ErrLlaveReutilizada", otro.repetido, otro.err)
	}
	if got, want := crcWallet(t, pool, userID), saldo-30000; got != want {
		t.Fatalf("saldo = %d, se esperaba %d", got, want)
	}
}

// El caso que mueve plata de verdad: la fila del primero todavia esta
// pendiente —escrita, sin asiento— cuando el segundo, con otro monto, choca
// con ella. Si sigue sobre esa fila, asienta SU monto con el id de la fila del
// otro: el libro mueve un monto y la fila dice otro, y el tope y la UIF cuentan
// el de la fila. Se tiene que rechazar antes del asiento.
func TestCrearOReconocer_OtroMontoNoSeAsientaSobreLaFilaPendienteDelPrimero(t *testing.T) {
	_, pool, userID := conPool(t)
	billeteraHolgada(t, pool, userID)
	frenoPrimero := nuevoFreno(true)
	frenoSegundo := nuevoFreno(false)
	primero := servicioSobre(testutil.PoolTrazado(t, frenoPrimero))
	segundo := servicioSobre(testutil.PoolTrazado(t, frenoSegundo))
	const llave = "carrera:pendiente-otro-monto"
	saldo := crcWallet(t, pool, userID)

	// El segundo pasa la relectura sin fila y espera antes de insertar; el
	// primero escribe su fila y espera antes de asentar.
	otro := lanzar(segundo, userID, compraDe(50000, llave))
	esperarCanal(t, frenoSegundo.llego, "que el segundo llegue a insertar su fila")
	propio := lanzar(primero, userID, compraDe(30000, llave))
	esperarCanal(t, frenoPrimero.llego, "que el primero escriba su fila")
	close(frenoSegundo.soltar)
	esperarCanal(t, otro.listo, "que el segundo termine")
	close(frenoPrimero.soltar)
	esperarCanal(t, propio.listo, "que el primero termine")

	if !errors.Is(otro.err, transaction.ErrLlaveReutilizada) {
		t.Fatalf("el segundo: repetido=%v err=%v, se esperaba ErrLlaveReutilizada: otra operacion se asento sobre la fila del primero",
			otro.repetido, otro.err)
	}
	if propio.err != nil || propio.repetido {
		t.Fatalf("el primero: repetido=%v err=%v, se esperaba su cobro nuevo", propio.repetido, propio.err)
	}
	if propio.rec.Amount != 30000 || propio.rec.Status != transaction.StatusCompleted {
		t.Fatalf("la fila del primero: monto=%d estado=%s", propio.rec.Amount, propio.rec.Status)
	}
	if got, want := crcWallet(t, pool, userID), saldo-30000; got != want {
		t.Fatalf("saldo = %d, se esperaba %d: el libro movio otro monto que el de la fila", got, want)
	}
}
