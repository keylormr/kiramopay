package transaction_test

import (
	"context"
	"errors"
	"testing"

	"github.com/kiramopay/backend/internal/transaction"
)

// La transferencia sin saldo devuelve el centinela, no un texto suelto: los
// handlers lo traducen a 422 INSUFFICIENT_BALANCE. Con el texto suelto, el
// SINPE cuyo saldo se fue entre la comprobacion previa y la transferencia
// salia como un 500.
func TestTransferirOReconocer_SinSaldoEsErrSaldoInsuficiente(t *testing.T) {
	svc, pool, emisor, receptor := setupTransferService(t)
	ctx := context.Background()
	if _, err := pool.Exec(ctx, `UPDATE wallets SET balance_crc = 0 WHERE user_id = $1::uuid`, emisor); err != nil {
		t.Fatalf("vaciar la billetera: %v", err)
	}

	_, _, _, err := svc.TransferirOReconocer(ctx, transferencia(emisor, receptor, 30000, "sin-saldo:transferencia"))
	if !errors.Is(err, transaction.ErrSaldoInsuficiente) {
		t.Fatalf("err = %v, se esperaba ErrSaldoInsuficiente", err)
	}
}
