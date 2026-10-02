package transaction_test

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/kiramopay/backend/internal/testutil"
	"github.com/kiramopay/backend/internal/transaction"
)

// TransferirOReconocer dice, ademas de la transferencia, si esta llamada movio
// el dinero o contesto con una que ya estaba hecha bajo la llave. SINPE lo usa
// para marcar la repeticion en la respuesta y para avisarle a quien recibe solo
// una vez; antes lo deducia de una bandera puesta por el gancho, que tambien
// corre en una pasada que despues se deshace.

func TestTransferirOReconocer_LaNuevaNoEsRepeticionYLaSegundaSi(t *testing.T) {
	svc, pool, emisor, receptor := setupTransferService(t)
	billeteraHolgada(t, pool, emisor)
	ctx := context.Background()
	const llave = "reconocer:secuencial"

	primera, _, repetido, err := svc.TransferirOReconocer(ctx, transferencia(emisor, receptor, 30000, llave))
	if err != nil || repetido {
		t.Fatalf("la primera: repetido=%v err=%v, se esperaba una transferencia nueva", repetido, err)
	}
	segunda, _, repetido, err := svc.TransferirOReconocer(ctx, transferencia(emisor, receptor, 30000, llave))
	if err != nil || !repetido {
		t.Fatalf("la segunda: repetido=%v err=%v, se esperaba la repeticion", repetido, err)
	}
	if segunda.ID != primera.ID {
		t.Fatalf("la repeticion devolvio %s, la transferencia fue %s", segunda.ID, primera.ID)
	}
}

// El que llega tarde a insertar encuentra la transferencia del otro ya
// completada: es la repeticion de algo hecho.
func TestTransferirOReconocer_ElQueInsertaTardeSobreUnaTransferenciaHechaEsRepeticion(t *testing.T) {
	svc, pool, emisor, receptor := setupTransferService(t)
	billeteraHolgada(t, pool, emisor)
	freno := nuevoFreno(false)
	tarde := servicioSobre(testutil.PoolTrazado(t, freno))
	const llave = "reconocer:tarde"
	saldo := crcWallet(t, pool, emisor)

	type resultado struct {
		id       string
		repetido bool
		err      error
	}
	listo := make(chan resultado, 1)
	go func() {
		emisorTx, _, repetido, err := tarde.TransferirOReconocer(context.Background(), transferencia(emisor, receptor, 30000, llave))
		r := resultado{repetido: repetido, err: err}
		if emisorTx != nil {
			r.id = emisorTx.ID
		}
		listo <- r
	}()
	esperarCanal(t, freno.llego, "que la segunda llegue a insertar su fila")
	primera, _, repetido, err := svc.TransferirOReconocer(context.Background(), transferencia(emisor, receptor, 30000, llave))
	if err != nil || repetido {
		t.Fatalf("la primera: repetido=%v err=%v, se esperaba la transferencia nueva", repetido, err)
	}
	close(freno.soltar)
	segunda := <-listo

	if segunda.err != nil {
		t.Fatalf("la segunda: %v", segunda.err)
	}
	if !segunda.repetido {
		t.Fatal("la segunda encontro la transferencia hecha y se informo como nueva")
	}
	if segunda.id != primera.ID {
		t.Fatalf("la segunda devolvio %s, la transferencia fue %s", segunda.id, primera.ID)
	}
	if got, want := crcWallet(t, pool, emisor), saldo-30000; got != want {
		t.Fatalf("saldo del emisor = %d, se esperaba %d", got, want)
	}
}

// El que inserta primero y se demora: el otro completa la transferencia sobre
// su fila, y cuando vuelve el asiento ya esta escrito. Es la repeticion; el que
// movio el dinero es el otro.
func TestTransferirOReconocer_ElQueEncuentraElAsientoYaEscritoEsRepeticion(t *testing.T) {
	svc, pool, emisor, receptor := setupTransferService(t)
	billeteraHolgada(t, pool, emisor)
	freno := nuevoFreno(true)
	demorado := servicioSobre(testutil.PoolTrazado(t, freno))
	const llave = "reconocer:asiento-escrito"
	saldo := crcWallet(t, pool, emisor)

	type resultado struct {
		id       string
		repetido bool
		err      error
	}
	listo := make(chan resultado, 1)
	go func() {
		emisorTx, _, repetido, err := demorado.TransferirOReconocer(context.Background(), transferencia(emisor, receptor, 30000, llave))
		r := resultado{repetido: repetido, err: err}
		if emisorTx != nil {
			r.id = emisorTx.ID
		}
		listo <- r
	}()
	esperarCanal(t, freno.llego, "que el primero inserte su fila")
	otra, _, repetido, err := svc.TransferirOReconocer(context.Background(), transferencia(emisor, receptor, 30000, llave))
	if err != nil || repetido {
		t.Fatalf("la que completa: repetido=%v err=%v, se esperaba que moviera el dinero", repetido, err)
	}
	close(freno.soltar)
	demora := <-listo

	if demora.err != nil {
		t.Fatalf("la demorada: %v", demora.err)
	}
	if !demora.repetido {
		t.Fatal("la demorada encontro el asiento ya escrito y se informo como transferencia nueva")
	}
	if demora.id != otra.ID {
		t.Fatalf("la demorada devolvio %s, la transferencia fue %s", demora.id, otra.ID)
	}
	if got, want := crcWallet(t, pool, emisor), saldo-30000; got != want {
		t.Fatalf("saldo del emisor = %d, se esperaba %d", got, want)
	}
}

func TestWithdrawMerchantToUser_LaRepeticionLoDice(t *testing.T) {
	svc, pool, pagador, dueno := setupTransferService(t)
	billeteraHolgada(t, pool, pagador)
	// El libro abre la cuenta del comercio con el primer cobro: basta un id.
	comercio := uuid.New().String()
	cobrarAlComercio(t, svc, pagador, comercio, 100000)
	ctx := context.Background()
	const llave = "reconocer:retiro"

	primero, repetido, err := svc.WithdrawMerchantToUser(ctx, comercio, "Tienda", dueno, "CRC", 40000, llave)
	if err != nil || repetido {
		t.Fatalf("el retiro: repetido=%v err=%v, se esperaba un retiro nuevo", repetido, err)
	}
	segundo, repetido, err := svc.WithdrawMerchantToUser(ctx, comercio, "Tienda", dueno, "CRC", 40000, llave)
	if err != nil || !repetido {
		t.Fatalf("la repeticion: repetido=%v err=%v", repetido, err)
	}
	if segundo.ID != primero.ID {
		t.Fatalf("la repeticion devolvio %s, el retiro fue %s", segundo.ID, primero.ID)
	}
}

// TransferenciaHecha es lo que consulta SINPE cuando ya no encuentra a quien
// recibe por el telefono: si la llave tiene ese mismo envio completado —mismo
// monto y mismo numero—, el reintento lo contesta en vez de decir "no es
// usuario".
func TestTransferenciaHecha(t *testing.T) {
	svc, pool, emisor, receptor := setupTransferService(t)
	billeteraHolgada(t, pool, emisor)
	ctx := context.Background()

	busca := func(llave string, monto int64, tipo, telefono string) *transaction.TransactionRecord {
		t.Helper()
		fila, err := svc.TransferenciaHecha(ctx, emisor, llave, monto, "CRC", tipo, telefono)
		if err != nil {
			t.Fatalf("TransferenciaHecha: %v", err)
		}
		return fila
	}

	const numero, otroNumero = "+50688885678", "+50677776666"
	if busca("", 30000, transaction.TypeP2PSend, numero) != nil {
		t.Fatal("sin llave no hay transferencia que contestar")
	}
	if busca("hecha:sin-fila", 30000, transaction.TypeP2PSend, numero) != nil {
		t.Fatal("una llave sin fila no tiene transferencia")
	}

	const llave = "hecha:completada"
	pedido := transferencia(emisor, receptor, 30000, llave)
	pedido.SenderCounterpartyPhone = numero
	hecha, _, err := svc.CreateTransfer(ctx, pedido)
	if err != nil {
		t.Fatalf("la transferencia: %v", err)
	}
	if fila := busca(llave, 30000, transaction.TypeP2PSend, numero); fila == nil || fila.ID != hecha.ID {
		t.Fatalf("la misma transferencia completada: %v, se esperaba %s", fila, hecha.ID)
	}
	if busca(llave, 50000, transaction.TypeP2PSend, numero) != nil {
		t.Fatal("otro monto bajo la llave no es aquella transferencia")
	}
	if busca(llave, 30000, transaction.TypeQRPayment, numero) != nil {
		t.Fatal("otro tipo bajo la llave no es aquella transferencia")
	}
	if busca(llave, 30000, transaction.TypeP2PSend, otroNumero) != nil {
		t.Fatal("otro numero bajo la llave no es aquella transferencia")
	}

	// Una transferencia completada que no guardo el telefono no contesta por
	// un pedido sin telefono: vacio contra vacio no es el mismo destino.
	const sinTelefono = "hecha:sin-telefono"
	if _, _, err := svc.CreateTransfer(ctx, transferencia(emisor, receptor, 30000, sinTelefono)); err != nil {
		t.Fatalf("la transferencia sin telefono: %v", err)
	}
	if busca(sinTelefono, 30000, transaction.TypeP2PSend, "") != nil {
		t.Fatal("sin telefono no hay destino que comparar: no es aquella transferencia")
	}

	const fallida = "hecha:fallida"
	insertarFilaCruda(t, pool, emisor, transaction.TypeP2PSend, "CRC", fallida, transaction.StatusFailed, 30000)
	if busca(fallida, 30000, transaction.TypeP2PSend, "") != nil {
		t.Fatal("una transferencia fallida no se contesta como hecha: el dinero no se movio")
	}
}
