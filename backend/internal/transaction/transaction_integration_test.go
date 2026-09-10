package transaction_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/kiramopay/backend/internal/ledger"
	"github.com/kiramopay/backend/internal/middleware"
	"github.com/kiramopay/backend/internal/testutil"
	"github.com/kiramopay/backend/internal/transaction"
	"github.com/kiramopay/backend/internal/wallet"
	"github.com/kiramopay/backend/pkg/hash"
)

func setupTxService(t *testing.T) (*transaction.Service, string) {
	t.Helper()
	svc, _, userID := setupTxServiceConPool(t)
	return svc, userID
}

func setupTxServiceConPool(t *testing.T) (*transaction.Service, *pgxpool.Pool, string) {
	t.Helper()
	pool := testutil.TestDB(t)
	txRepo := transaction.NewRepository(pool)
	walletRepo := wallet.NewRepository(pool)
	l := ledger.NewEngine(pool, slog.New(slog.NewJSONHandler(os.Stdout, nil)))
	svc := transaction.NewService(txRepo, walletRepo, l, nil)

	pinHash, _ := hash.HashPin("Kiramopay2024!")
	userID := testutil.SeedTestUser(t, pool, "702650930", pinHash)
	return svc, pool, userID
}

func TestCreateTransaction_Deposit(t *testing.T) {
	svc, userID := setupTxService(t)
	ctx := context.Background()
	tx, err := svc.CreateTransaction(ctx, userID, &transaction.CreateTransactionRequest{
		Type: "deposit", Amount: 100000000, Currency: "CRC", Internal: true,
	})
	if err != nil {
		t.Fatalf("CreateTransaction: %v", err)
	}
	if tx.ID == "" || tx.Type != "deposit" || tx.Amount != 100000000 {
		t.Fatalf("unexpected tx %+v", tx)
	}
}

// El agujero que esto cierra: cualquiera con sesion podia pedir por HTTP un
// tipo ENTRANTE -"deposit"- y acreditarse el saldo que quisiera. Todos los
// controles (saldo, limite diario, MFA) viven en la rama de salida, asi que un
// tipo entrante los saltaba enteros y el credito entraba al libro mayor.
func TestCreateTransaction_UnClienteNoPuedeAcreditarseDinero(t *testing.T) {
	svc, userID := setupTxService(t)
	ctx := context.Background()

	// Sin Internal, que es como llega cualquier peticion HTTP: el decodificador
	// de JSON no puede poner ese campo.
	_, err := svc.CreateTransaction(ctx, userID, &transaction.CreateTransactionRequest{
		Type: "deposit", Amount: 500_000_000, Currency: "CRC",
	})
	if !errors.Is(err, transaction.ErrCreditNotAllowed) {
		t.Fatalf("deposito pedido por un cliente = %v, esperaba ErrCreditNotAllowed", err)
	}

	// Y ningun tipo entrante pasa, se llame como se llame.
	for _, tipo := range []string{"deposit", "p2p_receive", "qr_receive", "refund", "crypto_sell", "savings_withdraw", "inventado"} {
		if _, err := svc.CreateTransaction(ctx, userID, &transaction.CreateTransactionRequest{
			Type: tipo, Amount: 1_000_000, Currency: "CRC",
		}); !errors.Is(err, transaction.ErrCreditNotAllowed) {
			t.Fatalf("tipo %q = %v, esperaba ErrCreditNotAllowed", tipo, err)
		}
	}
}

// POST /transactions ya no crea movimientos, y lo importante no es el codigo de
// error sino que EL SALDO NO SE MUEVA.
//
// La puerta aceptaba siete tipos "salientes" con el argumento de que sacar
// dinero del monedero propio pasa por saldo, limite y MFA. Era cierto y quemaba
// plata igual: el asiento que arma para ellos tiene UNA SOLA PATA contra
// SYSTEM:EXTERNAL, o sea debita la billetera y acredita "el exterior" sin que
// nadie entregue nada. Recibos y recargas ademas estan deliberadamente apagados
// por falta de convenio, y por aca entraban saltandose ese candado.
//
// Por eso la asercion es sobre el saldo: un cambio que devolviera el codigo
// correcto y siguiera debitando pasaria una prueba que solo mirara el status.
func TestCrear_YaNoMueveDinero(t *testing.T) {
	svc, pool, userID := setupTxServiceConPool(t)
	h := transaction.NewHandler(svc)

	saldo := func() int64 {
		var b int64
		if err := pool.QueryRow(context.Background(),
			`SELECT balance_crc FROM wallets WHERE user_id = $1::uuid`, userID).Scan(&b); err != nil {
			t.Fatalf("leer saldo: %v", err)
		}
		return b
	}
	antes := saldo()

	// Los siete tipos que la lista blanca aceptaba, mas uno inventado.
	for _, tipo := range []string{
		"sinpe_send", "qr_payment", "bill_payment", "recharge",
		"withdrawal", "p2p_send", "crypto_buy", "inventado",
	} {
		cuerpo, _ := json.Marshal(map[string]any{
			"type": tipo, "amount": 100_000, "currency": "CRC",
		})
		req := httptest.NewRequest(http.MethodPost, "/api/v1/transactions", bytes.NewReader(cuerpo))
		req = req.WithContext(context.WithValue(req.Context(), middleware.UserIDKey, userID))
		rec := httptest.NewRecorder()
		h.Create(rec, req)

		if rec.Code != http.StatusBadRequest {
			t.Fatalf("tipo %q: status %d, esperaba 400", tipo, rec.Code)
		}
		if despues := saldo(); despues != antes {
			t.Fatalf("tipo %q movio el saldo: antes %d, despues %d.\n"+
				"Esta ruta debita contra SYSTEM:EXTERNAL sin que nadie entregue nada.",
				tipo, antes, despues)
		}
	}

	// Y ninguna fila de movimiento quedo escrita.
	var filas int
	if err := pool.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM transactions WHERE user_id = $1::uuid`, userID).Scan(&filas); err != nil {
		t.Fatalf("contar movimientos: %v", err)
	}
	if filas != 0 {
		t.Fatalf("quedaron %d movimientos escritos por una ruta que ya no crea nada", filas)
	}
}

// Cada tipo que la puerta aceptaba tiene que apuntar a la ruta que SI lo
// entrega. Un mensaje que mande a una ruta inexistente es peor que no decir
// nada: manda a la persona a un callejon.
func TestRutaPropiaDe_ApuntaADondeSeEntrega(t *testing.T) {
	esperado := map[string]string{
		"sinpe_send":   "POST /api/v1/sinpe/send",
		"p2p_send":     "POST /api/v1/sinpe/send",
		"qr_payment":   "POST /api/v1/qr/pay",
		"bill_payment": "POST /api/v1/services/pay-bill",
		"recharge":     "POST /api/v1/services/recharge",
		"crypto_buy":   "POST /api/v1/crypto/buy",
	}
	for tipo, ruta := range esperado {
		got, hay := transaction.RutaPropiaDe(tipo)
		if !hay || got != ruta {
			t.Fatalf("%q -> (%q, %v), esperaba %q", tipo, got, hay, ruta)
		}
	}
	// Retirar no tiene integracion bancaria: no hay adonde mandar a nadie, y
	// decir que si la hay seria inventar.
	if ruta, hay := transaction.RutaPropiaDe("withdrawal"); hay {
		t.Fatalf("withdrawal no deberia ofrecer ruta, ofrecio %q", ruta)
	}
	if _, hay := transaction.RutaPropiaDe("inventado"); hay {
		t.Fatal("un tipo inventado no deberia ofrecer ruta")
	}
}

func TestCreateTransaction_SinpeSend(t *testing.T) {
	svc, userID := setupTxService(t)
	ctx := context.Background()
	tx, err := svc.CreateTransaction(ctx, userID, &transaction.CreateTransactionRequest{
		Type:              "sinpe_send",
		Amount:            5000000,
		Currency:          "CRC",
		Fee:               15000,
		CounterpartyName:  "Maria Lopez",
		CounterpartyPhone: "+50688885678",
		Description:       "Lunch payment",
	})
	if err != nil {
		t.Fatalf("CreateTransaction: %v", err)
	}
	if tx.Fee != 15000 || tx.CounterpartyName != "Maria Lopez" {
		t.Fatalf("unexpected tx %+v", tx)
	}
}

func TestCreateTransaction_IdempotencyShortCircuits(t *testing.T) {
	svc, userID := setupTxService(t)
	ctx := context.Background()
	req := &transaction.CreateTransactionRequest{
		Type: "deposit", Amount: 1000000, Currency: "CRC", Internal: true,
		IdempotencyKey: "tx-idem-1",
	}
	a, err := svc.CreateTransaction(ctx, userID, req)
	if err != nil {
		t.Fatalf("first create: %v", err)
	}
	b, err := svc.CreateTransaction(ctx, userID, req)
	if err != nil {
		t.Fatalf("second create: %v", err)
	}
	if a.ID != b.ID {
		t.Fatalf("idempotent retry must return same tx id (got %s vs %s)", a.ID, b.ID)
	}
}

func TestGetTransaction_Success(t *testing.T) {
	svc, userID := setupTxService(t)
	ctx := context.Background()
	created, err := svc.CreateTransaction(ctx, userID, &transaction.CreateTransactionRequest{
		Type: "deposit", Amount: 50000000, Currency: "CRC", Internal: true,
	})
	if err != nil {
		t.Fatalf("CreateTransaction: %v", err)
	}
	found, err := svc.GetTransaction(ctx, created.ID)
	if err != nil {
		t.Fatalf("GetTransaction: %v", err)
	}
	if found.ID != created.ID {
		t.Fatalf("id mismatch")
	}
}

func TestGetTransaction_NotFound(t *testing.T) {
	svc, _ := setupTxService(t)
	if _, err := svc.GetTransaction(context.Background(), "00000000-0000-0000-0000-000000000999"); err == nil {
		t.Fatal("expected error")
	}
}

func TestListTransactions_Pagination(t *testing.T) {
	svc, userID := setupTxService(t)
	ctx := context.Background()
	for i := 0; i < 5; i++ {
		if _, err := svc.CreateTransaction(ctx, userID, &transaction.CreateTransactionRequest{
			Type: "deposit", Amount: int64((i + 1) * 1000000), Currency: "CRC", Internal: true,
		}); err != nil {
			t.Fatalf("create #%d: %v", i, err)
		}
	}
	resp, err := svc.ListTransactions(ctx, userID, &transaction.ListTransactionsRequest{Limit: 2})
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if resp.Total != 5 {
		t.Fatalf("expected total 5, got %d", resp.Total)
	}
	if len(resp.Transactions) != 2 {
		t.Fatalf("expected page size 2, got %d", len(resp.Transactions))
	}
}

// The analytics view asks the SERVER for a date window and a currency; before
// these filters it could only see whatever page the client happened to hold.
func TestListTransactions_FilterByDateAndCurrency(t *testing.T) {
	svc, userID := setupTxService(t)
	ctx := context.Background()
	if _, err := svc.CreateTransaction(ctx, userID, &transaction.CreateTransactionRequest{
		Type: "deposit", Amount: 1000000, Currency: "CRC", Internal: true,
	}); err != nil {
		t.Fatalf("deposit CRC: %v", err)
	}
	if _, err := svc.CreateTransaction(ctx, userID, &transaction.CreateTransactionRequest{
		Type: "deposit", Amount: 2000, Currency: "USD", Internal: true,
	}); err != nil {
		t.Fatalf("deposit USD: %v", err)
	}

	// A window that starts in the future matches nothing.
	future := time.Now().Add(time.Hour)
	resp, err := svc.ListTransactions(ctx, userID, &transaction.ListTransactionsRequest{From: future, Limit: 20})
	if err != nil {
		t.Fatalf("list future: %v", err)
	}
	if resp.Total != 0 || len(resp.Transactions) != 0 {
		t.Fatalf("future window: total=%d len=%d, se esperaba 0/0", resp.Total, len(resp.Transactions))
	}

	// A window around now matches both, and the count agrees with the page.
	resp, err = svc.ListTransactions(ctx, userID, &transaction.ListTransactionsRequest{
		From: time.Now().Add(-time.Hour), To: future, Limit: 20,
	})
	if err != nil {
		t.Fatalf("list window: %v", err)
	}
	if resp.Total != 2 || len(resp.Transactions) != 2 {
		t.Fatalf("window: total=%d len=%d, se esperaba 2/2", resp.Total, len(resp.Transactions))
	}

	// Currency narrows to the USD deposit only.
	resp, err = svc.ListTransactions(ctx, userID, &transaction.ListTransactionsRequest{Currency: "USD", Limit: 20})
	if err != nil {
		t.Fatalf("list USD: %v", err)
	}
	if resp.Total != 1 || len(resp.Transactions) != 1 || resp.Transactions[0].Currency != "USD" {
		t.Fatalf("USD filter: total=%d len=%d, se esperaba solo el deposito USD", resp.Total, len(resp.Transactions))
	}
}

func TestListTransactions_FilterByType(t *testing.T) {
	svc, userID := setupTxService(t)
	ctx := context.Background()
	if _, err := svc.CreateTransaction(ctx, userID, &transaction.CreateTransactionRequest{
		Type: "deposit", Amount: 1000000, Currency: "CRC", Internal: true,
	}); err != nil {
		t.Fatalf("deposit: %v", err)
	}
	if _, err := svc.CreateTransaction(ctx, userID, &transaction.CreateTransactionRequest{
		Type: "sinpe_send", Amount: 500000, Currency: "CRC",
	}); err != nil {
		t.Fatalf("sinpe: %v", err)
	}
	resp, err := svc.ListTransactions(ctx, userID, &transaction.ListTransactionsRequest{
		Type: "deposit", Limit: 20,
	})
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if resp.Total != 1 {
		t.Fatalf("expected 1 deposit, got %d", resp.Total)
	}
}

// El buscador de la pantalla de movimientos filtraba lo que el cliente ya tenia
// en memoria —las ultimas 50 filas—, asi que un movimiento del mes pasado no
// aparecia y el usuario concluia que no existia. Ahora busca el SERVIDOR, sobre
// todo el historial, y el Total que devuelve es el de la busqueda: es lo que
// permite decir cuantos movimientos hay de verdad y no cuantos se alcanzaron a
// bajar.
func TestListTransactions_BusquedaPorTexto(t *testing.T) {
	svc, userID := setupTxService(t)
	ctx := context.Background()

	crear := func(tipo, nombre, descripcion string) {
		t.Helper()
		if _, err := svc.CreateTransaction(ctx, userID, &transaction.CreateTransactionRequest{
			Type: tipo, Amount: 100000, Currency: "CRC", Internal: true,
			CounterpartyName: nombre, Description: descripcion,
		}); err != nil {
			t.Fatalf("crear %s/%s: %v", tipo, nombre, err)
		}
	}
	crear("deposit", "Panaderia La Espiga", "pan del domingo")
	crear("deposit", "Ferreteria El Clavo", "tornillos")
	crear("refund", "", "reembolso de la panaderia")

	buscar := func(q string) *transaction.TransactionListResponse {
		t.Helper()
		resp, err := svc.ListTransactions(ctx, userID, &transaction.ListTransactionsRequest{
			Search: q, Limit: 20,
		})
		if err != nil {
			t.Fatalf("buscar %q: %v", q, err)
		}
		return resp
	}

	// Por nombre de contraparte, sin importar mayusculas.
	if r := buscar("espiga"); r.Total != 1 || len(r.Transactions) != 1 {
		t.Fatalf("buscar espiga: total=%d len=%d, se esperaba 1/1", r.Total, len(r.Transactions))
	}
	// Por descripcion: la fila del reembolso no tiene contraparte.
	if r := buscar("reembolso"); r.Total != 1 || len(r.Transactions) != 1 {
		t.Fatalf("buscar reembolso: total=%d len=%d, se esperaba 1/1", r.Total, len(r.Transactions))
	}
	// "panaderia" aparece en el nombre de una fila y en la descripcion de otra.
	if r := buscar("panaderia"); r.Total != 2 {
		t.Fatalf("buscar panaderia: total=%d, se esperaba 2", r.Total)
	}
	// Por tipo de movimiento, que es lo que la pantalla rotula traducido.
	if r := buscar("refund"); r.Total != 1 {
		t.Fatalf("buscar refund: total=%d, se esperaba 1", r.Total)
	}
	// Lo que no existe, no aparece.
	if r := buscar("bicicleta"); r.Total != 0 || len(r.Transactions) != 0 {
		t.Fatalf("buscar bicicleta: total=%d len=%d, se esperaba 0/0", r.Total, len(r.Transactions))
	}
	// Espacios alrededor no cambian la busqueda.
	if r := buscar("  espiga  "); r.Total != 1 {
		t.Fatalf("buscar con espacios: total=%d, se esperaba 1", r.Total)
	}
	// Un texto vacio NO es un filtro: devuelve el historial completo.
	if r := buscar("   "); r.Total != 3 {
		t.Fatalf("buscar vacio: total=%d, se esperaba 3 (sin filtrar)", r.Total)
	}
}

// Los comodines de LIKE se escapan. Sin esto, quien busca "%" recibe TODO el
// historial como si fuera el resultado de su busqueda.
func TestListTransactions_BusquedaEscapaComodines(t *testing.T) {
	svc, userID := setupTxService(t)
	ctx := context.Background()

	for _, nombre := range []string{"Descuento 50% martes", "Tienda normal"} {
		if _, err := svc.CreateTransaction(ctx, userID, &transaction.CreateTransactionRequest{
			Type: "deposit", Amount: 100000, Currency: "CRC", Internal: true,
			CounterpartyName: nombre,
		}); err != nil {
			t.Fatalf("crear %s: %v", nombre, err)
		}
	}

	buscar := func(q string) int {
		t.Helper()
		resp, err := svc.ListTransactions(ctx, userID, &transaction.ListTransactionsRequest{
			Search: q, Limit: 20,
		})
		if err != nil {
			t.Fatalf("buscar %q: %v", q, err)
		}
		return resp.Total
	}

	// "%" es un caracter que la persona escribio, no un comodin.
	if n := buscar("%"); n != 1 {
		t.Fatalf("buscar %%: total=%d, se esperaba 1 (solo la fila que lo contiene)", n)
	}
	if n := buscar("50%"); n != 1 {
		t.Fatalf("buscar 50%%: total=%d, se esperaba 1", n)
	}
	// "_" tampoco comodinea: ninguna fila lo contiene.
	if n := buscar("_"); n != 0 {
		t.Fatalf("buscar _: total=%d, se esperaba 0", n)
	}
	// Y la barra invertida no rompe el patron.
	if n := buscar(`\`); n != 0 {
		t.Fatalf(`buscar \: total=%d, se esperaba 0`, n)
	}
}
