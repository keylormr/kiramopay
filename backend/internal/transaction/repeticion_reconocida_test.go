package transaction_test

import (
	"context"
	"sync"
	"testing"

	"github.com/kiramopay/backend/internal/transaction"
)

// CrearOReconocer es CreateTransaction con un dato mas: si la respuesta repite
// un movimiento que ya estaba hecho bajo esa llave. Repeticion es solo lo que
// no movio dinero en esta llamada; el primer cobro de una fila fallida no lo
// es, aunque la llave ya tuviera fila.

func cobrar(t *testing.T, svc *transaction.Service, userID, llave string) (*transaction.TransactionRecord, bool) {
	t.Helper()
	rec, repetido, err := svc.CrearOReconocer(context.Background(), userID, &transaction.CreateTransactionRequest{
		Type: transaction.TypeCryptoBuy, Amount: 30000, Currency: "CRC", IdempotencyKey: llave,
	})
	if err != nil {
		t.Fatalf("CrearOReconocer(%s): %v", llave, err)
	}
	return rec, repetido
}

func TestCrearOReconocer_ElPrimerCobroNoEsRepeticion(t *testing.T) {
	svc, _, userID := conPool(t)
	if _, repetido := cobrar(t, svc, userID, "reconocer:primero"); repetido {
		t.Fatal("el primer cobro se informo como repeticion")
	}
}

func TestCrearOReconocer_ElCobroCompletadoSeReconoce(t *testing.T) {
	svc, pool, userID := conPool(t)
	const llave = "reconocer:completado"
	primero, _ := cobrar(t, svc, userID, llave)
	saldo := crcWallet(t, pool, userID)

	segundo, repetido := cobrar(t, svc, userID, llave)
	if !repetido {
		t.Fatal("la repeticion de un cobro completado se informo como cobro nuevo")
	}
	if segundo.ID != primero.ID {
		t.Fatalf("la repeticion devolvio %s, el cobro fue %s", segundo.ID, primero.ID)
	}
	if got := crcWallet(t, pool, userID); got != saldo {
		t.Fatalf("saldo = %d, se esperaba %d: la repeticion cobro", got, saldo)
	}
}

// La fila que quedo sin marcar aunque su asiento confirmo: el dinero se movio
// la primera vez y esta llamada solo arregla el rotulo.
func TestCrearOReconocer_LaFilaSinMarcarQueSeReparaEsRepeticion(t *testing.T) {
	svc, pool, userID := conPool(t)
	const llave = "reconocer:sin-marcar"
	primero, _ := cobrar(t, svc, userID, llave)
	forzarEstado(t, pool, primero.ID, transaction.StatusPending)

	if _, repetido := cobrar(t, svc, userID, llave); !repetido {
		t.Fatal("la reparacion de un cobro que ya se hizo se informo como cobro nuevo")
	}
}

// Al reves: una fila fallida no tiene asiento, y el reintento mueve el dinero
// por primera vez.
func TestCrearOReconocer_LaFilaFallidaQueSeCobraNoEsRepeticion(t *testing.T) {
	svc, pool, userID := conPool(t)
	const llave = "reconocer:fallida"
	insertarFilaCruda(t, pool, userID, transaction.TypeCryptoBuy, "CRC", llave, transaction.StatusFailed, 30000)
	saldo := crcWallet(t, pool, userID)

	if _, repetido := cobrar(t, svc, userID, llave); repetido {
		t.Fatal("el primer cobro de una fila fallida se informo como repeticion")
	}
	if got, want := crcWallet(t, pool, userID), saldo-30000; got != want {
		t.Fatalf("saldo = %d, se esperaba %d", got, want)
	}
}

// Varios intentos a la vez con la misma llave: uno solo mueve el dinero y es el
// unico que no se informa como repeticion. Los demas llegan por los caminos de
// la carrera —la insercion que gano otro, el asiento que otro ya escribio— y
// tambien tienen que decirlo.
func TestCrearOReconocer_DeVariosIntentosSimultaneosUnoSoloEsNuevo(t *testing.T) {
	svc, pool, userID := conPool(t)
	const llave = "reconocer:simultaneos"
	const intentos = 3
	saldo := crcWallet(t, pool, userID)

	ids := make([]string, intentos)
	repetidos := make([]bool, intentos)
	errs := make([]error, intentos)
	salida := make(chan struct{})
	var wg sync.WaitGroup
	for i := range intentos {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-salida
			rec, repetido, err := svc.CrearOReconocer(context.Background(), userID, &transaction.CreateTransactionRequest{
				Type: transaction.TypeCryptoBuy, Amount: 30000, Currency: "CRC", IdempotencyKey: llave,
			})
			repetidos[i], errs[i] = repetido, err
			if rec != nil {
				ids[i] = rec.ID
			}
		}(i)
	}
	close(salida)
	wg.Wait()

	nuevos := 0
	for i := range intentos {
		if errs[i] != nil {
			t.Fatalf("intento %d: %v", i, errs[i])
		}
		if ids[i] != ids[0] {
			t.Fatalf("un intento devolvio %s y otro %s", ids[0], ids[i])
		}
		if !repetidos[i] {
			nuevos++
		}
	}
	if nuevos != 1 {
		t.Fatalf("%d intentos se informaron como cobro nuevo, se esperaba 1", nuevos)
	}
	if got, want := crcWallet(t, pool, userID), saldo-30000; got != want {
		t.Fatalf("saldo = %d, se esperaba %d: se cobro mas de una vez", got, want)
	}
}
