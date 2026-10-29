package splitpay

import (
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/kiramopay/backend/pkg/response"
)

// Cancelar una division donde alguien ya pago sale con su propio codigo y un
// 409, para que la pantalla explique el motivo en el idioma de la persona. Los
// demas motivos del modulo conservan CANCEL_FAILED, y un fallo de la base es un
// 500 que no filtra el detalle al cliente.

func TestRespuestaDeLaCancelacion(t *testing.T) {
	casos := []struct {
		nombre string
		err    error
		estado int
		codigo string
	}{
		{"con pagos", ErrSplitHasPayments, http.StatusConflict, "SPLIT_HAS_PAYMENTS"},
		{"con pagos, envuelto", fmt.Errorf("cancelar: %w", ErrSplitHasPayments), http.StatusConflict, "SPLIT_HAS_PAYMENTS"},
		{"no existe", ErrGroupNotFound, http.StatusBadRequest, "CANCEL_FAILED"},
		{"no es el creador", ErrNotCreator, http.StatusBadRequest, "CANCEL_FAILED"},
		{"ya no esta activa", ErrNotActive, http.StatusBadRequest, "CANCEL_FAILED"},
		{"fallo de la base", errors.New("pq: relation secreta"), http.StatusInternalServerError, "CANCEL_FAILED"},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			estado, codigo, _ := respuestaDeLaCancelacion(c.err)
			if estado != c.estado || codigo != c.codigo {
				t.Fatalf("respuesta = %d %q, se esperaba %d %q", estado, codigo, c.estado, c.codigo)
			}
		})
	}
}

// Los motivos de un 4xx llevan texto fijo; el de un 500 no sale al cliente.
func TestRespuestaDeLaCancelacion_ElDetalleDeUnFalloInternoNoSale(t *testing.T) {
	estado, codigo, msg := respuestaDeLaCancelacion(errors.New("pq: relation secreta"))
	rec := httptest.NewRecorder()
	response.Error(rec, estado, codigo, msg)

	if strings.Contains(rec.Body.String(), "secreta") {
		t.Fatalf("el 500 filtro el detalle interno: %s", rec.Body.String())
	}
}

// Una division con pagos no es una peticion mal formada: no debe contestar como
// los rechazos de forma de "crear" ni envolver a ErrInvalidRequest.
func TestErrSplitHasPayments_NoEsUnaPeticionInvalida(t *testing.T) {
	if errors.Is(ErrSplitHasPayments, ErrInvalidRequest) {
		t.Fatal("ErrSplitHasPayments no debe envolver a ErrInvalidRequest")
	}
}
