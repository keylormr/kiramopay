package splitpay

import (
	"errors"
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/kiramopay/backend/internal/ledger"
)

// Quien creo el reparto pidio eliminar su cuenta: el libro rechazo limpio y
// nada se movio. El pago responde el codigo propio, sin el texto interno del
// error, que le diria a un tercero que esa cuenta esta cerrada.
func TestRespuestaDelPago_LaCuentaDelCreadorEstaCerrada(t *testing.T) {
	err := fmt.Errorf("settle split share: post ledger: %w", ledger.ErrCuentaCerrada)
	status, code, msg := respuestaDelPago(err)
	if status != http.StatusUnprocessableEntity || code != "RECIPIENT_UNAVAILABLE" {
		t.Fatalf("respuesta = %d %s, se esperaba 422 RECIPIENT_UNAVAILABLE", status, code)
	}
	if strings.Contains(msg, ":") || strings.Contains(msg, "cerrada") {
		t.Errorf("el mensaje arrastra el error interno: %q", msg)
	}
}

func TestRespuestaDelPago_ElRestoSigueIgual(t *testing.T) {
	status, code, _ := respuestaDelPago(errors.New("otra cosa"))
	if status != http.StatusBadRequest || code != "PAY_FAILED" {
		t.Fatalf("respuesta = %d %s, se esperaba 400 PAY_FAILED", status, code)
	}
}
