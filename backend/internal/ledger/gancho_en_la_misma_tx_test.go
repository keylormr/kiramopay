package ledger_test

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/kiramopay/backend/internal/ledger"
	"github.com/kiramopay/backend/internal/testutil"
)

// El gancho EnLaMismaTx existe para que la fila del modulo que pidio el asiento
// y el movimiento de dinero se confirmen juntos. Estas dos pruebas comprueban
// las dos mitades de esa promesa; sin las dos, el gancho seria decoracion.
func prepararGancho(t *testing.T) (*ledger.Engine, string, string, func(string, string) int64) {
	t.Helper()
	pool := testutil.TestDB(t)
	de := testutil.SeedTestUser(t, pool, "702650930", "dummy")
	a := testutil.SeedTestUser2(t, pool)
	eng := ledger.NewEngine(pool, slog.New(slog.NewTextHandler(os.Stdout, nil)))

	if _, err := pool.Exec(context.Background(),
		`CREATE TABLE IF NOT EXISTS prueba_del_gancho (id TEXT PRIMARY KEY)`); err != nil {
		t.Fatalf("crear tabla de prueba: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DROP TABLE IF EXISTS prueba_del_gancho`)
	})

	contar := func(consulta, arg string) int64 {
		t.Helper()
		var n int64
		if err := pool.QueryRow(context.Background(), consulta, arg).Scan(&n); err != nil {
			t.Fatalf("contar: %v", err)
		}
		return n
	}
	return eng, de, a, contar
}

const cuentaSaldo = `SELECT COALESCE(balance_crc, 0) FROM wallets WHERE user_id = $1::uuid`
const cuentaAsientos = `SELECT COUNT(*) FROM journal_postings WHERE idempotency_key = $1`
const cuentaFilas = `SELECT COUNT(*) FROM prueba_del_gancho WHERE id = $1`

// Si el gancho falla, el dinero NO se mueve. Es la razon de existir del gancho:
// antes el asiento confirmaba y la fila del modulo se escribia despues, asi que
// un fallo ahi dejaba plata movida que nada reflejaba.
func TestGancho_ElFalloRevierteElAsiento(t *testing.T) {
	eng, de, a, contar := prepararGancho(t)
	ctx := context.Background()

	saldoAntes := contar(cuentaSaldo, de)
	fallo := errors.New("la fila del modulo no se pudo escribir")

	_, err := eng.Post(ctx, &ledger.Posting{
		Description:    "gancho que falla",
		IdempotencyKey: "gancho-falla-1",
		Entries: []ledger.Entry{
			{Account: ledger.Account{UserID: de}, Side: ledger.Debit, AmountMinor: 500, Currency: "CRC"},
			{Account: ledger.Account{UserID: a}, Side: ledger.Credit, AmountMinor: 500, Currency: "CRC"},
		},
		EnLaMismaTx: func(ctx context.Context, tx pgx.Tx) error {
			// Escribe primero, para que la prueba distinga "no se ejecuto" de
			// "se ejecuto y se revirtio".
			if _, err := tx.Exec(ctx,
				`INSERT INTO prueba_del_gancho (id) VALUES ($1)`, "gancho-falla-1"); err != nil {
				return err
			}
			return fallo
		},
	})
	if err == nil {
		t.Fatal("el asiento se confirmo pese a que el gancho fallo")
	}
	if !errors.Is(err, fallo) {
		t.Fatalf("el error del gancho no llega al llamador: %v", err)
	}
	if n := contar(cuentaAsientos, "gancho-falla-1"); n != 0 {
		t.Fatalf("quedo un asiento confirmado: %d", n)
	}
	if n := contar(cuentaFilas, "gancho-falla-1"); n != 0 {
		t.Fatalf("la escritura del gancho no se revirtio: %d filas", n)
	}
	if saldoDespues := contar(cuentaSaldo, de); saldoDespues != saldoAntes {
		t.Fatalf("el saldo cambio pese al fallo: antes %d, despues %d", saldoAntes, saldoDespues)
	}
}

// Y al confirmar, lo que escribio el gancho esta ahi junto con el asiento.
func TestGancho_LoQueEscribeSeConfirmaConElAsiento(t *testing.T) {
	eng, de, a, contar := prepararGancho(t)
	ctx := context.Background()

	if _, err := eng.Post(ctx, &ledger.Posting{
		Description:    "gancho que confirma",
		IdempotencyKey: "gancho-ok-1",
		Entries: []ledger.Entry{
			{Account: ledger.Account{UserID: de}, Side: ledger.Debit, AmountMinor: 500, Currency: "CRC"},
			{Account: ledger.Account{UserID: a}, Side: ledger.Credit, AmountMinor: 500, Currency: "CRC"},
		},
		EnLaMismaTx: func(ctx context.Context, tx pgx.Tx) error {
			_, err := tx.Exec(ctx, `INSERT INTO prueba_del_gancho (id) VALUES ($1)`, "gancho-ok-1")
			return err
		},
	}); err != nil {
		t.Fatalf("post: %v", err)
	}

	if n := contar(cuentaAsientos, "gancho-ok-1"); n != 1 {
		t.Fatalf("esperaba 1 asiento, hay %d", n)
	}
	if n := contar(cuentaFilas, "gancho-ok-1"); n != 1 {
		t.Fatalf("el gancho no dejo su fila: %d", n)
	}
}
