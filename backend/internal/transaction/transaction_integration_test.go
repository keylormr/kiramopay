package transaction_test

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"testing"
	"time"

	"github.com/kiramopay/backend/internal/ledger"
	"github.com/kiramopay/backend/internal/testutil"
	"github.com/kiramopay/backend/internal/transaction"
	"github.com/kiramopay/backend/internal/wallet"
	"github.com/kiramopay/backend/pkg/hash"
)

func setupTxService(t *testing.T) (*transaction.Service, string) {
	t.Helper()
	pool := testutil.TestDB(t)
	txRepo := transaction.NewRepository(pool)
	walletRepo := wallet.NewRepository(pool)
	l := ledger.NewEngine(pool, slog.New(slog.NewJSONHandler(os.Stdout, nil)))
	svc := transaction.NewService(txRepo, walletRepo, l, nil)

	pinHash, _ := hash.HashPin("Kiramopay2024!")
	userID := testutil.SeedTestUser(t, pool, "702650930", pinHash)
	return svc, userID
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

// La lista blanca del endpoint: solo lo que saca dinero del monedero propio,
// que es lo que pasa por saldo, limite y MFA.
func TestIsUserInitiable_SoloLoQueSale(t *testing.T) {
	permitidos := []string{"sinpe_send", "qr_payment", "bill_payment", "recharge", "withdrawal", "p2p_send", "crypto_buy"}
	for _, tipo := range permitidos {
		if !transaction.IsUserInitiable(tipo) {
			t.Fatalf("%q deberia poder pedirlo una persona", tipo)
		}
	}
	prohibidos := []string{"deposit", "p2p_receive", "qr_receive", "refund", "crypto_sell", "savings_deposit", "savings_withdraw", "merchant_withdrawal", "", "cualquier_cosa"}
	for _, tipo := range prohibidos {
		if transaction.IsUserInitiable(tipo) {
			t.Fatalf("%q NO deberia poder pedirlo una persona", tipo)
		}
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
		Type: "deposit", Amount: 1000000, Currency: "CRC",
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
			Type: "deposit", Amount: int64((i + 1) * 1000000), Currency: "CRC",
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
		Type: "deposit", Amount: 1000000, Currency: "CRC",
	}); err != nil {
		t.Fatalf("deposit CRC: %v", err)
	}
	if _, err := svc.CreateTransaction(ctx, userID, &transaction.CreateTransactionRequest{
		Type: "deposit", Amount: 2000, Currency: "USD",
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
		Type: "deposit", Amount: 1000000, Currency: "CRC",
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
