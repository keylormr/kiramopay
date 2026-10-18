package qrpayment_test

import (
	"context"
	"errors"
	"testing"

	"github.com/kiramopay/backend/internal/qrpayment"
)

// El codigo personal de quien pidio eliminar su cuenta deja de servir para
// mandarle cripto. El cripto no pasa por el libro, asi que la cuenta cerrada no
// lo frena: sin esto, lo que alguien le mandara en el plazo quedaria adentro,
// impediria el cierre del dia 30 y la persona no podria sacarlo.
func TestPersonaDelQR_UnaCuentaPorEliminarNoRecibe(t *testing.T) {
	svc, pool, _, owner := setupQR(t)
	ctx := context.Background()
	code, err := svc.GetOrCreateMyCode(ctx, owner, "CRC")
	if err != nil {
		t.Fatalf("GetOrCreateMyCode: %v", err)
	}
	if _, err := svc.PersonaDelQR(ctx, code.QRData); err != nil {
		t.Fatalf("con la cuenta activa el codigo debia servir: %v", err)
	}
	if _, err := pool.Exec(ctx, `UPDATE users
		SET status = 'pending_deletion', deletion_requested_at = NOW(),
		    deletion_due_at = NOW() + interval '30 days', deletion_terms_accepted_at = NOW(),
		    deletion_channel = 'in_app'
		WHERE id = $1::uuid`, owner); err != nil {
		t.Fatalf("marcar por eliminar: %v", err)
	}

	if _, err := svc.PersonaDelQR(ctx, code.QRData); !errors.Is(err, qrpayment.ErrQRRevocado) {
		t.Fatalf("PersonaDelQR = %v, se esperaba ErrQRRevocado", err)
	}
}
