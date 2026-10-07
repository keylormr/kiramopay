package transaction_test

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/kiramopay/backend/internal/transaction"
)

// Una fila sin completar y sin asiento que es de OTRO dia no se completa con
// su fecha vieja. El tope diario suma por created_date: el dinero que se movia
// hoy sobre la fila de ayer no contaba para el tope de hoy. Mientras la llave
// moria con la sesion, hacia falta un reintento que cruzara la medianoche; al
// conservarla entre sesiones, deja de ser raro.

// alDiaAnterior corre la fila un dia hacia atras, como si el intento que se
// cayo hubiera sido ayer.
func alDiaAnterior(t *testing.T, pool *pgxpool.Pool, id string) {
	t.Helper()
	if _, err := pool.Exec(context.Background(),
		`UPDATE transactions
		    SET created_date = created_date - 1, created_at = created_at - INTERVAL '1 day'
		  WHERE id = $1`, id); err != nil {
		t.Fatalf("correr la fila al dia anterior: %v", err)
	}
}

func esDeHoy(t *testing.T, pool *pgxpool.Pool, id string) bool {
	t.Helper()
	var hoy bool
	if err := pool.QueryRow(context.Background(),
		`SELECT created_date = CURRENT_DATE FROM transactions WHERE id = $1`, id).Scan(&hoy); err != nil {
		t.Fatalf("leer la fecha de %s: %v", id, err)
	}
	return hoy
}

func salidaDeHoy(t *testing.T, pool *pgxpool.Pool, userID string) int64 {
	t.Helper()
	total, err := transaction.NewRepository(pool).DailyOutgoingMinor(context.Background(), userID, "CRC")
	if err != nil {
		t.Fatalf("salida de hoy: %v", err)
	}
	return total
}

func TestOperacion_LaFilaSinAsientoDeOtroDiaNoSeCompletaConSuFecha(t *testing.T) {
	svc, pool, userID := conPool(t)
	ctx := context.Background()
	const llave = "otro-dia:operacion"
	const monto int64 = 75000
	pedido := func() *transaction.CreateTransactionRequest {
		return &transaction.CreateTransactionRequest{
			Type: transaction.TypeCryptoBuy, Amount: monto, Currency: "CRC", IdempotencyKey: llave,
		}
	}

	ayer := insertarFilaCruda(t, pool, userID, transaction.TypeCryptoBuy, "CRC", llave, transaction.StatusFailed, monto)
	alDiaAnterior(t, pool, ayer)
	antes := salidaDeHoy(t, pool, userID)

	tx, err := svc.CreateTransaction(ctx, userID, pedido())
	if err != nil {
		t.Fatalf("CreateTransaction: %v", err)
	}
	if tx.ID == ayer || !esDeHoy(t, pool, tx.ID) {
		t.Fatalf("el movimiento quedo en la fila de ayer (%s): su dinero no cuenta para el tope de hoy", tx.ID)
	}
	if got := salidaDeHoy(t, pool, userID); got != antes+monto {
		t.Fatalf("salida de hoy = %d, se esperaba %d", got, antes+monto)
	}
	if got := estadoDeFila(t, pool, ayer); got != transaction.StatusFailed {
		t.Fatalf("la fila de ayer quedo %q, se esperaba %q", got, transaction.StatusFailed)
	}
	if n := asientosConLlave(t, pool, llave); n != 1 {
		t.Fatalf("asientos con la llave = %d, se esperaba 1", n)
	}

	// El reintento contesta con la fila de hoy, la completada, y no mueve nada.
	saldo := crcWallet(t, pool, userID)
	otra, err := svc.CreateTransaction(ctx, userID, pedido())
	if err != nil {
		t.Fatalf("el reintento: %v", err)
	}
	if otra.ID != tx.ID {
		t.Fatalf("el reintento contesto con %s, el movimiento fue %s", otra.ID, tx.ID)
	}
	if got := crcWallet(t, pool, userID); got != saldo {
		t.Fatalf("el reintento movio dinero: saldo %d, era %d", got, saldo)
	}
}

func TestTransferencia_LasFilasSinAsientoDeOtroDiaNoSeCompletanConSuFecha(t *testing.T) {
	svc, pool, emisor, receptor := setupTransferService(t)
	billeteraHolgada(t, pool, emisor)
	ctx := context.Background()
	const llave = "otro-dia:transferencia"
	const monto int64 = 30000
	const numero = "+50688885678"
	pedido := func() *transaction.CreateTransferRequest {
		p := transferencia(emisor, receptor, monto, llave)
		p.SenderCounterpartyPhone = numero
		return p
	}

	envioAyer := insertarFilaCruda(t, pool, emisor, transaction.TypeP2PSend, "CRC", llave, transaction.StatusFailed, monto)
	recepcionAyer := insertarFilaCruda(t, pool, receptor, transaction.TypeP2PReceive, "CRC", llave+":recv", transaction.StatusFailed, monto)
	alDiaAnterior(t, pool, envioAyer)
	alDiaAnterior(t, pool, recepcionAyer)
	antes := salidaDeHoy(t, pool, emisor)

	envio, recepcion, repetido, err := svc.TransferirOReconocer(ctx, pedido())
	if err != nil {
		t.Fatalf("TransferirOReconocer: %v", err)
	}
	if repetido {
		t.Fatal("es la primera vez que el dinero se mueve: no es una repeticion")
	}
	if envio.ID == envioAyer || !esDeHoy(t, pool, envio.ID) {
		t.Fatalf("el envio quedo en la fila de ayer (%s): su dinero no cuenta para el tope de hoy", envio.ID)
	}
	if recepcion == nil || recepcion.ID == recepcionAyer || !esDeHoy(t, pool, recepcion.ID) {
		t.Fatalf("lo recibido quedo en la fila de ayer: %v", recepcion)
	}
	if got := salidaDeHoy(t, pool, emisor); got != antes+monto {
		t.Fatalf("salida de hoy = %d, se esperaba %d", got, antes+monto)
	}
	for _, id := range []string{envioAyer, recepcionAyer} {
		if got := estadoDeFila(t, pool, id); got != transaction.StatusFailed {
			t.Fatalf("la fila de ayer %s quedo %q, se esperaba %q", id, got, transaction.StatusFailed)
		}
	}
	if n := asientosConLlave(t, pool, llave); n != 1 {
		t.Fatalf("asientos con la llave = %d, se esperaba 1", n)
	}

	// Con dos filas bajo la llave, lo que la lee encuentra la completada: la
	// cuenta cerrada (TransferenciaHecha) y la repeticion.
	hecha, err := svc.TransferenciaHecha(ctx, emisor, llave, monto, "CRC", transaction.TypeP2PSend, numero)
	if err != nil || hecha == nil || hecha.ID != envio.ID {
		t.Fatalf("TransferenciaHecha = %v (err %v), se esperaba %s", hecha, err, envio.ID)
	}
	otro, _, repetido, err := svc.TransferirOReconocer(ctx, pedido())
	if err != nil || !repetido || otro.ID != envio.ID {
		t.Fatalf("la repeticion: %v repetido=%v err=%v, se esperaba %s", otro, repetido, err, envio.ID)
	}
}

func TestRetiro_LaFilaSinAsientoDeOtroDiaNoSeCompletaConSuFecha(t *testing.T) {
	svc, pool, emisor, dueno := setupTransferService(t)
	ctx := context.Background()
	comercio := uuid.New().String()
	const cobrado int64 = 200000
	const retiro int64 = 120000

	// Se le cobra al comercio para que tenga saldo propio.
	if _, _, err := svc.CreateTransfer(ctx, &transaction.CreateTransferRequest{
		FromUserID: emisor, ToMerchantID: comercio, Amount: cobrado, Currency: "CRC",
		IdempotencyKey: "otro-dia:cobro",
		TxType:         transaction.TypeQRPayment, ReceiveType: transaction.TypeQRReceive,
	}); err != nil {
		t.Fatalf("cobro al comercio: %v", err)
	}

	const llave = "otro-dia:retiro"
	ayer := insertarFilaCruda(t, pool, dueno, transaction.TypeMerchantWithdrawal, "CRC", llave, transaction.StatusFailed, retiro)
	alDiaAnterior(t, pool, ayer)

	rec, repetido, err := svc.WithdrawMerchantToUser(ctx, comercio, "Tienda", dueno, "CRC", retiro, llave)
	if err != nil || repetido {
		t.Fatalf("el retiro: repetido=%v err=%v", repetido, err)
	}
	if rec.ID == ayer || !esDeHoy(t, pool, rec.ID) {
		t.Fatalf("el retiro quedo en la fila de ayer (%s): sale con la fecha de un intento que no movio nada", rec.ID)
	}
	if got := estadoDeFila(t, pool, ayer); got != transaction.StatusFailed {
		t.Fatalf("la fila de ayer quedo %q, se esperaba %q", got, transaction.StatusFailed)
	}
	if n := asientosConLlave(t, pool, llave); n != 1 {
		t.Fatalf("asientos con la llave = %d, se esperaba 1", n)
	}

	otro, repetido, err := svc.WithdrawMerchantToUser(ctx, comercio, "Tienda", dueno, "CRC", retiro, llave)
	if err != nil || !repetido || otro.ID != rec.ID {
		t.Fatalf("la repeticion: %v repetido=%v err=%v, se esperaba %s", otro, repetido, err, rec.ID)
	}
}
