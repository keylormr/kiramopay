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

// Lo que no se reconoce es un fallo del servidor y no del pedido: 500 con el
// codigo de siempre. El detalle queda en el log; al cliente no sale.
func TestRespuestaDelPago_LoQueNoSeReconoceEsUn500(t *testing.T) {
	status, code, _ := respuestaDelPago(errors.New("otra cosa"))
	if status != http.StatusInternalServerError || code != "PAY_FAILED" {
		t.Fatalf("respuesta = %d %s, se esperaba 500 PAY_FAILED", status, code)
	}
}

// Los rechazos propios de la division siguen siendo 400 PAY_FAILED.
func TestRespuestaDelPago_LosMotivosDelModuloSiguenSiendo400(t *testing.T) {
	for _, motivo := range motivosDelModulo {
		envuelto := fmt.Errorf("settle split share: %w", motivo.err)
		status, code, msg := respuestaDelPago(envuelto)
		if status != http.StatusBadRequest || code != "PAY_FAILED" || msg != motivo.msg {
			t.Errorf("%v: respuesta = %d %s %q, se esperaba 400 PAY_FAILED %q", motivo.err, status, code, msg, motivo.msg)
		}
	}
}
