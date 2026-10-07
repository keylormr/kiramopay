package transaction_test

import (
	"context"
	"testing"

	"github.com/kiramopay/backend/internal/testutil"
	"github.com/kiramopay/backend/internal/transaction"
)

// TransferenciaYaTieneRespuesta es lo que consulta SINPE cuando su comprobacion
// de cortesia —el cupo del dia, el saldo— no alcanza: si la llave ya contesta
// por si sola, la comprobacion no tiene nada que decir.
func TestTransferenciaYaTieneRespuesta(t *testing.T) {
	svc, pool, emisor, receptor := setupTransferService(t)
	tercero := testutil.SeedTestUser3(t, pool)
	billeteraHolgada(t, pool, emisor)
	ctx := context.Background()

	pregunta := func(req *transaction.CreateTransferRequest) bool {
		t.Helper()
		responde, err := svc.TransferenciaYaTieneRespuesta(ctx, req)
		if err != nil {
			t.Fatalf("TransferenciaYaTieneRespuesta: %v", err)
		}
		return responde
	}

	if pregunta(transferencia(emisor, receptor, 30000, "")) {
		t.Fatal("sin llave no hay nada que conteste")
	}
	if pregunta(transferencia(emisor, receptor, 30000, "respuesta:sin-fila")) {
		t.Fatal("una llave sin fila no contesta: la transferencia esta por hacerse")
	}

	const hecha = "respuesta:hecha"
	if _, _, err := svc.CreateTransfer(ctx, transferencia(emisor, receptor, 30000, hecha)); err != nil {
		t.Fatalf("la transferencia: %v", err)
	}
	if !pregunta(transferencia(emisor, receptor, 30000, hecha)) {
		t.Fatal("la misma transferencia ya completada tiene que contestar")
	}
	sinMoneda := transferencia(emisor, receptor, 30000, hecha)
	sinMoneda.Currency = ""
	if !pregunta(sinMoneda) {
		t.Fatal("sin moneda es en colones, igual que en CreateTransfer: tiene que reconocer su propia fila")
	}
	if !pregunta(transferencia(emisor, receptor, 50000, hecha)) {
		t.Fatal("otro monto con la misma llave contesta: con la llave de otra transferencia")
	}
	if !pregunta(transferencia(emisor, tercero, 30000, hecha)) {
		t.Fatal("otro destino con la misma llave contesta: con la llave de otra transferencia")
	}

	// La que fallo no contesta: su asiento no confirmo, el dinero sigue donde
	// estaba y la comprobacion de cortesia dice la verdad.
	const fallida = "respuesta:fallida"
	insertarFilaCruda(t, pool, emisor, transaction.TypeP2PSend, "CRC", fallida, transaction.StatusFailed, 30000)
	if pregunta(transferencia(emisor, receptor, 30000, fallida)) {
		t.Fatal("una transferencia fallida no contesta por la llave")
	}
}
