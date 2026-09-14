package qrpayment

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/kiramopay/backend/internal/transaction"
)

func codigoDe(t *testing.T, rec *httptest.ResponseRecorder) (string, string) {
	t.Helper()
	var sobre struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &sobre); err != nil {
		t.Fatalf("respuesta ilegible: %v (%s)", err, rec.Body.String())
	}
	return sobre.Error.Code, sobre.Error.Message
}

// Pagar por QR por encima del umbral del segundo factor respondia 400
// PAYMENT_FAILED "qr payment transfer: mfa challenge required": ni un codigo
// que la pantalla supiera tratar ni forma de completar el pago. Ahora es el
// mismo contrato que SINPE, y el error llega envuelto igual que desde el
// servicio.
func TestResponderError_SegundoFactorEsElContratoDeSinpe(t *testing.T) {
	rec := httptest.NewRecorder()
	responderError(rec, fmt.Errorf("qr payment transfer: %w", transaction.ErrMFARequired))
	codigo, _ := codigoDe(t, rec)
	if rec.Code != http.StatusPreconditionRequired || codigo != "MFA_REQUIRED" {
		t.Fatalf("%d %s, se esperaba 428 MFA_REQUIRED", rec.Code, codigo)
	}
}

func TestResponderError_CobroConMontoNoPositivoTieneCodigoPropio(t *testing.T) {
	rec := httptest.NewRecorder()
	responderError(rec, ErrMontoInvalido)
	codigo, _ := codigoDe(t, rec)
	if rec.Code != http.StatusBadRequest || codigo != "MONTO_INVALIDO" {
		t.Fatalf("%d %s, se esperaba 400 MONTO_INVALIDO", rec.Code, codigo)
	}

	// Lo que no tiene codigo propio sigue cayendo al generico de siempre.
	rec = httptest.NewRecorder()
	responderError(rec, errors.New("insufficient balance"))
	if codigo, msg := codigoDe(t, rec); rec.Code != http.StatusBadRequest || codigo != "PAYMENT_FAILED" || msg != "insufficient balance" {
		t.Fatalf("%d %s %q, se esperaba 400 PAYMENT_FAILED con el mensaje original", rec.Code, codigo, msg)
	}
}

func TestResponderErrorDeEquipo_CedulaSinCuenta(t *testing.T) {
	rec := httptest.NewRecorder()
	responderErrorDeEquipo(rec, "ADD_STAFF_FAILED", ErrCedulaSinCuenta)
	codigo, _ := codigoDe(t, rec)
	if rec.Code != http.StatusUnprocessableEntity || codigo != "STAFF_CEDULA_NOT_FOUND" {
		t.Fatalf("%d %s, se esperaba 422 STAFF_CEDULA_NOT_FOUND", rec.Code, codigo)
	}

	// Un rol invalido conserva el codigo y el mensaje que ya tenia la ruta.
	rec = httptest.NewRecorder()
	responderErrorDeEquipo(rec, "ADD_STAFF_FAILED", errors.New("invalid role"))
	if codigo, msg := codigoDe(t, rec); rec.Code != http.StatusBadRequest || codigo != "ADD_STAFF_FAILED" || msg != "invalid role" {
		t.Fatalf("%d %s %q, se esperaba 400 ADD_STAFF_FAILED invalid role", rec.Code, codigo, msg)
	}
}
