package sinpe

import (
	"errors"
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/kiramopay/backend/internal/ledger"
	"github.com/kiramopay/backend/internal/transaction"
)

// Los rechazos que las pruebas de integracion no alcanzan a provocar: llegan
// envueltos como suben de verdad ("create transaction: post ledger: ...") y
// salen con su codigo y el texto del rechazo, sin los prefijos.
func TestRespuestaDelRechazo(t *testing.T) {
	envuelto := func(err error) error {
		return fmt.Errorf("create transaction: %w", fmt.Errorf("post ledger: %w", err))
	}
	casos := []struct {
		nombre string
		err    error
		estado int
		codigo string
	}{
		{"la llave ya tiene el asiento de otro movimiento", envuelto(transaction.ErrLlaveDeOtroMovimiento),
			http.StatusConflict, "LLAVE_REUTILIZADA"},
		{"el saldo que frena el asiento", envuelto(ledger.ErrInsufficientFunds),
			http.StatusUnprocessableEntity, "INSUFFICIENT_BALANCE"},
		{"el tope mensual", envuelto(transaction.ErrMonthlyLimitExceeded),
			http.StatusUnprocessableEntity, "MONTHLY_LIMIT_EXCEEDED"},
		{"el motor de riesgo", envuelto(transaction.ErrBloqueadoPorRiesgo),
			http.StatusBadRequest, "SINPE_FAILED"},
		{"la base fallo al buscar a quien recibe", ErrBuscarDestino,
			http.StatusInternalServerError, "SINPE_FAILED"},
		{"cualquier otro", envuelto(errors.New("conn reset")),
			http.StatusInternalServerError, "SINPE_FAILED"},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			estado, codigo, mensaje := respuestaDelRechazo(c.err)
			if estado != c.estado || codigo != c.codigo {
				t.Fatalf("= %d %s, se esperaba %d %s", estado, codigo, c.estado, c.codigo)
			}
			// Un 5xx lleva el detalle al log y response.Error lo tapa; un 4xx
			// sale tal cual, asi que no puede llevar los prefijos internos.
			if estado < http.StatusInternalServerError && strings.Contains(mensaje, ":") {
				t.Fatalf("el texto lleva los prefijos internos: %q", mensaje)
			}
		})
	}
}
