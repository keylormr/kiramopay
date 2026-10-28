package transaction_test

import (
	"context"
	"log/slog"
	"os"
	"testing"

	"github.com/kiramopay/backend/internal/ledger"
	"github.com/kiramopay/backend/internal/testutil"
	"github.com/kiramopay/backend/internal/transaction"
	"github.com/kiramopay/backend/internal/wallet"
	"github.com/kiramopay/backend/pkg/hash"
)

// Las cuentas de contraparte se eligen por la moneda del movimiento.
//
// Lo que fallaba: buildSingleSidedPosting fijaba SYSTEM:EXTERNAL:CRC para toda
// operacion contra el exterior, aunque la moneda fuera USD. La cuenta de
// comisiones si cambiaba a la version USD; la externa no. El libro cuadra
// igual —los asientos balancean por moneda—, pero la cuenta externa terminaba
// con dolares anotados dentro de una cuenta DECLARADA en colones, y cualquier
// conciliacion por moneda salia mal. Es alcanzable con una compra o venta de
// cripto en dolares y con depositos y retiros en dolares.
//
// Desde las reservas al 100 %, un deposito o un retiro tiene la RESERVA de la
// moneda por contraparte, y la cripto tiene la posicion externa mas el
// capital propio y la reserva: las tres tienen que seguir la moneda.
//
// Sin el arreglo esta prueba falla: el asiento aparece en una cuenta de la
// otra moneda.
func TestPosting_LasContrapartesSiguenLaMoneda(t *testing.T) {
	pool := testutil.TestDB(t)
	l := ledger.NewEngine(pool, slog.New(slog.NewJSONHandler(os.Stdout, nil)))
	svc := transaction.NewService(transaction.NewRepository(pool), wallet.NewRepository(pool), l, nil)
	pinHash, _ := hash.HashPin("Kiramopay2024!")
	userID := testutil.SeedTestUser(t, pool, "702650930", pinHash)
	ctx := context.Background()

	casos := []struct {
		nombre   string
		tipoMov  string
		moneda   string
		tipoCta  string
		esperada string
	}{
		{"deposito en dolares va a la reserva en dolares", "deposit", "USD", "reserve", "SYSTEM:RESERVE:USD"},
		{"deposito en colones va a la reserva en colones", "deposit", "CRC", "reserve", "SYSTEM:RESERVE:CRC"},
		{"venta de cripto en dolares: posicion externa en dolares", "crypto_sell", "USD", "external", "SYSTEM:EXTERNAL:USD"},
		{"venta de cripto en colones: posicion externa en colones", "crypto_sell", "CRC", "external", "SYSTEM:EXTERNAL:CRC"},
		{"venta de cripto en dolares: capital propio en dolares", "crypto_sell", "USD", "capital", "SYSTEM:CAPITAL:USD"},
		{"venta de cripto en colones: capital propio en colones", "crypto_sell", "CRC", "capital", "SYSTEM:CAPITAL:CRC"},
	}

	for i, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			tx, err := svc.CreateTransaction(ctx, userID, &transaction.CreateTransactionRequest{
				Type: c.tipoMov, Amount: 1000, Currency: c.moneda, Internal: true,
				IdempotencyKey: "contraparte:" + c.tipoMov + ":" + c.moneda + ":" + string(rune('a'+i)),
			})
			if err != nil {
				t.Fatalf("%s en %s: %v", c.tipoMov, c.moneda, err)
			}

			var codigo, monedaCuenta string
			err = pool.QueryRow(ctx,
				`SELECT la.code, la.currency
				   FROM journal_entries je
				   JOIN journal_postings jp ON jp.id = je.posting_id
				   JOIN ledger_accounts  la ON la.id = je.account_id
				  WHERE jp.tx_id = $1::uuid AND la.type = $2`,
				tx.ID, c.tipoCta,
			).Scan(&codigo, &monedaCuenta)
			if err != nil {
				t.Fatalf("buscar la cuenta de tipo %s del asiento: %v", c.tipoCta, err)
			}
			if codigo != c.esperada {
				t.Errorf("un movimiento en %s se anoto en %s, esperaba %s", c.moneda, codigo, c.esperada)
			}
			// Lo que de verdad importa: la moneda del asiento y la de la
			// cuenta donde queda anotado tienen que ser la misma.
			if monedaCuenta != c.moneda {
				t.Errorf("asiento en %s anotado en una cuenta declarada en %s", c.moneda, monedaCuenta)
			}
		})
	}
}
