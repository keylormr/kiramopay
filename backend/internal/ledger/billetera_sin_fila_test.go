package ledger_test

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"testing"

	"github.com/kiramopay/backend/internal/ledger"
	"github.com/kiramopay/backend/internal/testutil"
)

// Cuando el UPDATE del saldo no encuentra la fila de wallets, el libro la
// aprovisiona con un INSERT ... ON CONFLICT. Ese INSERT no sirve para restar:
// Postgres evalua los CHECK de saldo no negativo sobre la fila que propone,
// antes de resolver el conflicto, y es exactamente lo que impedia vender
// cripto. En el esquema de pruebas, que no tiene esos CHECK, el debito pasaba
// y dejaba una billetera en negativo.
func TestDebitarSinFilaDeBilleteraNoLaCreaEnNegativo(t *testing.T) {
	pool := testutil.TestDB(t)
	sinFila := testutil.SeedTestUser(t, pool, "702650930", "dummy")
	otro := testutil.SeedTestUser2(t, pool)
	eng := ledger.NewEngine(pool, slog.New(slog.NewTextHandler(os.Stdout, nil)))
	ctx := context.Background()

	if _, err := pool.Exec(ctx, `DELETE FROM wallets WHERE user_id = $1::uuid`, sinFila); err != nil {
		t.Fatalf("quitar la billetera: %v", err)
	}
	saldoOtro := walletCRC(t, pool, otro)
	filas := func() int {
		t.Helper()
		var n int
		if err := pool.QueryRow(ctx,
			`SELECT COUNT(*) FROM wallets WHERE user_id = $1::uuid`, sinFila).Scan(&n); err != nil {
			t.Fatalf("contar billeteras: %v", err)
		}
		return n
	}

	_, err := eng.Post(ctx, &ledger.Posting{
		Description:    "debito sin billetera",
		IdempotencyKey: "debito-sin-billetera",
		Entries: []ledger.Entry{
			{Account: ledger.Account{UserID: sinFila}, Side: ledger.Debit, AmountMinor: 500, Currency: "CRC"},
			{Account: ledger.Account{UserID: otro}, Side: ledger.Credit, AmountMinor: 500, Currency: "CRC"},
		},
	})
	if !errors.Is(err, ledger.ErrInsufficientFunds) {
		t.Fatalf("debitar sin billetera = %v, se esperaba ErrInsufficientFunds", err)
	}
	if n := filas(); n != 0 {
		t.Fatalf("billeteras de quien no tenia = %d, se esperaba 0: se creo una en negativo", n)
	}
	if got := walletCRC(t, pool, otro); got != saldoOtro {
		t.Fatalf("saldo de la contraparte = %d, se esperaba %d", got, saldoOtro)
	}
	var asientos int
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM journal_postings WHERE idempotency_key = 'debito-sin-billetera'`).Scan(&asientos); err != nil {
		t.Fatalf("contar asientos: %v", err)
	}
	if asientos != 0 {
		t.Fatalf("asientos = %d, se esperaba 0", asientos)
	}

	// Abonar si la aprovisiona, como siempre.
	if _, err := eng.Post(ctx, &ledger.Posting{
		Description:    "abono sin billetera",
		IdempotencyKey: "abono-sin-billetera",
		Entries: []ledger.Entry{
			{Account: ledger.Account{UserID: otro}, Side: ledger.Debit, AmountMinor: 500, Currency: "CRC"},
			{Account: ledger.Account{UserID: sinFila}, Side: ledger.Credit, AmountMinor: 500, Currency: "CRC"},
		},
	}); err != nil {
		t.Fatalf("abonar sin billetera: %v", err)
	}
	if n := filas(); n != 1 {
		t.Fatalf("billeteras = %d, se esperaba 1", n)
	}
	if got := walletCRC(t, pool, sinFila); got != 500 {
		t.Fatalf("saldo aprovisionado = %d, se esperaba 500", got)
	}
}
