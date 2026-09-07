package uif_test

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/kiramopay/backend/internal/transaction"
	"github.com/kiramopay/backend/internal/uif"
)

// El agregado diario de la UIF tiene que contar TODOS los tipos que sacan
// dinero de la billetera, no un subconjunto.
//
// Por que existe esta prueba: la lista de la UIF y la del tope diario de gasto
// estaban escritas por separado. Al agregarse escrow, payouts y marketplace,
// la del tope se actualizo y la de la UIF no. El resultado no fue un error:
// fue que la deteccion de estructuracion dejo de ver ese dinero en silencio,
// que es exactamente lo que un vigilante no puede hacer.
//
// Se recorre transaction.TiposDeSalida a proposito: si manana aparece un tipo
// nuevo de salida y alguien no lo cablea aqui, esta prueba lo dice.
func TestUIF_AgregadoDiarioCuentaTodaSalida(t *testing.T) {
	_, _, pool, userID := setupUIF(t)
	ctx := context.Background()

	repo := uif.NewRepository(pool)

	var walletID string
	if err := pool.QueryRow(ctx,
		`SELECT id::text FROM wallets WHERE user_id = $1::uuid`, userID).Scan(&walletID); err != nil {
		t.Fatalf("buscar billetera: %v", err)
	}

	const monto int64 = 1_000
	var esperado int64

	for _, tipo := range transaction.TiposDeSalida {
		if _, err := pool.Exec(ctx,
			`INSERT INTO transactions (id, wallet_id, user_id, type, amount, currency, status, completed_at)
			 VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, 'CRC', 'completed', NOW())`,
			uuid.New().String(), walletID, userID, tipo, monto); err != nil {
			t.Fatalf("insertar movimiento %q: %v", tipo, err)
		}
		esperado += monto

		total, err := repo.GetUserDailyOutgoingTotal(ctx, userID, "CRC")
		if err != nil {
			t.Fatalf("GetUserDailyOutgoingTotal tras %q: %v", tipo, err)
		}
		if total != esperado {
			t.Fatalf("el tipo %q no suma al agregado diario de la UIF: total %d, esperado %d.\n"+
				"Esa salida de dinero es invisible para la deteccion de estructuracion.", tipo, total, esperado)
		}
	}
}

// Un tipo que NO saca dinero de la billetera no debe inflar el agregado: si
// contara, la deteccion dispararia reportes sobre plata que nunca salio.
func TestUIF_AgregadoDiarioIgnoraLoQueNoEsSalida(t *testing.T) {
	_, _, pool, userID := setupUIF(t)
	ctx := context.Background()

	repo := uif.NewRepository(pool)

	var walletID string
	if err := pool.QueryRow(ctx,
		`SELECT id::text FROM wallets WHERE user_id = $1::uuid`, userID).Scan(&walletID); err != nil {
		t.Fatalf("buscar billetera: %v", err)
	}

	for _, tipo := range []string{"sinpe_receive", "deposit", "savings_deposit", "crypto_sell"} {
		if _, err := pool.Exec(ctx,
			`INSERT INTO transactions (id, wallet_id, user_id, type, amount, currency, status, completed_at)
			 VALUES ($1::uuid, $2::uuid, $3::uuid, $4, 500000, 'CRC', 'completed', NOW())`,
			uuid.New().String(), walletID, userID, tipo); err != nil {
			t.Fatalf("insertar movimiento %q: %v", tipo, err)
		}
	}

	total, err := repo.GetUserDailyOutgoingTotal(ctx, userID, "CRC")
	if err != nil {
		t.Fatalf("GetUserDailyOutgoingTotal: %v", err)
	}
	if total != 0 {
		t.Fatalf("el agregado diario conto entradas o ahorro como salida: %d", total)
	}
}
