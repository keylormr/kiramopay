package splitpay

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/kiramopay/backend/internal/ledger"
	"github.com/kiramopay/backend/internal/transaction"
	"github.com/kiramopay/backend/pkg/response"
)

// Pagar una cuota de 100.000 colones o mas sin segundo factor respondia 400
// PAY_FAILED con el texto interno ("settle split share: mfa challenge
// required"). Toda salida de dinero desde ese monto responde 428 MFA_REQUIRED
// para que la pantalla pida el segundo factor, y ninguna respuesta puede
// llevar el texto de un error interno.

// loQueVeElCliente pasa la respuesta por response.Error, igual que el
// handler: es lo que sale por la red, con los 5xx ya sin su detalle.
func loQueVeElCliente(t *testing.T, err error) (int, string, string) {
	t.Helper()
	status, code, msg := respuestaDelPago(err)
	rec := httptest.NewRecorder()
	response.Error(rec, status, code, msg)
	var cuerpo struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if e := json.Unmarshal(rec.Body.Bytes(), &cuerpo); e != nil {
		t.Fatalf("la respuesta no es JSON: %s", rec.Body.String())
	}
	return rec.Code, cuerpo.Error.Code, cuerpo.Error.Message
}

func TestRespuestaDelPago_SinSegundoFactorPideElSegundoFactor(t *testing.T) {
	// Asi sube el error desde el libro: envuelto dos veces.
	err := fmt.Errorf("settle split share: %w", fmt.Errorf("create transfer: %w", transaction.ErrMFARequired))

	status, code, msg := loQueVeElCliente(t, err)

	if status != http.StatusPreconditionRequired || code != "MFA_REQUIRED" {
		t.Fatalf("respuesta = %d %s, se esperaba 428 MFA_REQUIRED", status, code)
	}
	if strings.Contains(msg, "settle split share") || strings.Contains(msg, "create transfer") {
		t.Errorf("el mensaje arrastra el error interno: %q", msg)
	}
}

// Los demas motivos del dinero tienen el mismo codigo que en el resto de las
// salidas (SINPE, recibos, pagos): la pantalla ya sabe explicarlos.
func TestRespuestaDelPago_LosMotivosDelDineroTienenCodigoPropio(t *testing.T) {
	casos := []struct {
		err    error
		status int
		codigo string
	}{
		{transaction.ErrSaldoInsuficiente, http.StatusUnprocessableEntity, "INSUFFICIENT_BALANCE"},
		{ledger.ErrInsufficientFunds, http.StatusUnprocessableEntity, "INSUFFICIENT_BALANCE"},
		{transaction.ErrDailyLimitExceeded, http.StatusUnprocessableEntity, "DAILY_LIMIT_EXCEEDED"},
		{transaction.ErrMonthlyLimitExceeded, http.StatusUnprocessableEntity, "MONTHLY_LIMIT_EXCEEDED"},
		{transaction.ErrBloqueadoPorRiesgo, http.StatusBadRequest, "TRANSFER_BLOCKED"},
	}
	for _, c := range casos {
		envuelto := fmt.Errorf("settle split share: %w", c.err)
		status, code, msg := loQueVeElCliente(t, envuelto)
		if status != c.status || code != c.codigo {
			t.Errorf("%v: respuesta = %d %s, se esperaba %d %s", c.err, status, code, c.status, c.codigo)
		}
		if strings.Contains(msg, "settle split share") {
			t.Errorf("%v: el mensaje arrastra el error interno: %q", c.err, msg)
		}
	}
}

// Ninguna respuesta lleva el prefijo del modulo, el rastro de una capa ni el
// texto de la base: ni la de un motivo conocido ni la de un fallo que no se
// reconoce.
func TestRespuestaDelPago_NingunaRespuestaDejaVerTextoInterno(t *testing.T) {
	errores := []error{
		ErrGroupNotFound,
		ErrNotActive,
		ErrNoShareForUser,
		ErrCuotaNoReclamable,
		ErrUnauthenticated,
		fmt.Errorf("settle split share: %w", ErrCuotaNoReclamable),
		fmt.Errorf("settle split share: post ledger: %w", errors.New(`ERROR: relation "split_shares" does not exist (SQLSTATE 42P01)`)),
		errors.New("otra cosa"),
	}
	prohibidos := []string{"splitpay:", "settle split share", "post ledger", "SQLSTATE", "relation", "otra cosa"}
	for _, err := range errores {
		_, _, msg := loQueVeElCliente(t, err)
		for _, p := range prohibidos {
			if strings.Contains(msg, p) {
				t.Errorf("%v: la respuesta deja ver %q: %q", err, p, msg)
			}
		}
	}
}
