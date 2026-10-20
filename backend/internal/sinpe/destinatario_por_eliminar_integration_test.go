package sinpe_test

import (
	"context"
	"errors"
	"testing"

	"github.com/kiramopay/backend/internal/sinpe"
)

// Quien pidio eliminar su cuenta no recibe dinero: el envio se rechaza al
// buscar a quien recibe, como a un numero sin cuenta, y nada se mueve. El libro
// ya lo impediria (la cuenta esta cerrada), pero el rechazo llega antes y con el
// motivo que la pantalla sabe explicar.
func TestSend_AUnaCuentaPorEliminar_SeRechaza(t *testing.T) {
	svc, userID, pool := setupSinpeService(t)
	ctx := context.Background()
	// El destinatario de las pruebas, que setupSinpeService ya sembro.
	const destinatario = "00000000-0000-0000-0000-000000000002"
	if _, err := pool.Exec(ctx, `UPDATE users
		SET status = 'pending_deletion', deletion_requested_at = NOW(),
		    deletion_due_at = NOW() + interval '30 days', deletion_terms_accepted_at = NOW(),
		    deletion_channel = 'in_app'
		WHERE id = $1::uuid`, destinatario); err != nil {
		t.Fatalf("marcar por eliminar: %v", err)
	}
	var antes int64
	if err := pool.QueryRow(ctx, `SELECT balance_crc FROM wallets WHERE user_id = $1::uuid`, userID).Scan(&antes); err != nil {
		t.Fatal(err)
	}

	_, err := svc.Send(ctx, userID, &sinpe.SendRequest{Phone: "+50688885678", Amount: 100000}, "")
	if !errors.Is(err, sinpe.ErrRecipientNotUser) {
		t.Fatalf("error = %v, se esperaba ErrRecipientNotUser", err)
	}
	var despues int64
	if err := pool.QueryRow(ctx, `SELECT balance_crc FROM wallets WHERE user_id = $1::uuid`, userID).Scan(&despues); err != nil {
		t.Fatal(err)
	}
	if despues != antes {
		t.Fatalf("el rechazo movio dinero: %d -> %d", antes, despues)
	}
}
