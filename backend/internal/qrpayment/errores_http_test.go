package qrpayment

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/kiramopay/backend/internal/ledger"
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

	// Lo que no tiene codigo propio es un fallo del servidor: 500 con el codigo
	// de siempre y el detalle solo en el log. Salia 400 con el error tal cual,
	// y crear un cobro que fallaba en la base le mostraba a la persona la frase
	// del driver.
	rec = httptest.NewRecorder()
	responderError(rec, errors.New(`insert charge: ERROR: relation "qr_charges_secreta" does not exist`))
	if codigo, msg := codigoDe(t, rec); rec.Code != http.StatusInternalServerError || codigo != "PAYMENT_FAILED" ||
		strings.Contains(msg, "secreta") {
		t.Fatalf("%d %s %q, se esperaba 500 PAYMENT_FAILED sin el detalle", rec.Code, codigo, msg)
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

// El motor de transferencias rechaza con su propio ErrLlaveReutilizada la
// llave de un pago que describe otro monto. Caia al PAYMENT_FAILED generico,
// mientras que el mismo caso detectado por el modulo respondia 409
// LLAVE_REUTILIZADA: dos respuestas para una sola situacion.
func TestResponderError_LlaveDeOtraTransferenciaEs409(t *testing.T) {
	rec := httptest.NewRecorder()
	responderError(rec, fmt.Errorf("qr payment transfer: %w", transaction.ErrLlaveReutilizada))
	codigo, _ := codigoDe(t, rec)
	if rec.Code != http.StatusConflict || codigo != "LLAVE_REUTILIZADA" {
		t.Fatalf("%d %s, se esperaba 409 LLAVE_REUTILIZADA", rec.Code, codigo)
	}
}

// Los rechazos del motor de transferencias, que comparten SINPE y QR, salen con
// el mismo codigo que en SINPE. En QR caian al PAYMENT_FAILED generico con el
// error envuelto ("qr payment transfer: insufficient balance"), y la pantalla
// lo mostraba tal cual, en ingles.
func TestResponderError_LosRechazosDeLaTransferenciaTienenCodigoPropio(t *testing.T) {
	casos := []struct {
		err    error
		estado int
		codigo string
	}{
		{transaction.ErrSaldoInsuficiente, http.StatusUnprocessableEntity, "INSUFFICIENT_BALANCE"},
		// El del asiento, que es el que frena bajo concurrencia.
		{ledger.ErrInsufficientFunds, http.StatusUnprocessableEntity, "INSUFFICIENT_BALANCE"},
		// Quien cobra pidio eliminar su cuenta: el asiento se rechazo limpio.
		{ledger.ErrCuentaCerrada, http.StatusUnprocessableEntity, "RECIPIENT_UNAVAILABLE"},
		{transaction.ErrDailyLimitExceeded, http.StatusUnprocessableEntity, "DAILY_LIMIT_EXCEEDED"},
		{transaction.ErrMonthlyLimitExceeded, http.StatusUnprocessableEntity, "MONTHLY_LIMIT_EXCEEDED"},
		{transaction.ErrBloqueadoPorRiesgo, http.StatusBadRequest, "TRANSFER_BLOCKED"},
		// La llave que ya es de otro movimiento, vista desde el libro.
		{transaction.ErrLlaveDeOtroMovimiento, http.StatusConflict, "LLAVE_REUTILIZADA"},
	}
	for _, c := range casos {
		rec := httptest.NewRecorder()
		responderError(rec, fmt.Errorf("qr payment transfer: %w", c.err))
		codigo, msg := codigoDe(t, rec)
		if rec.Code != c.estado || codigo != c.codigo {
			t.Errorf("%v = %d %s, se esperaba %d %s", c.err, rec.Code, codigo, c.estado, c.codigo)
		}
		if strings.Contains(msg, "qr payment transfer") {
			t.Errorf("%v: el texto lleva los prefijos internos: %q", c.err, msg)
		}
	}
}

// Un fallo de la base al sumar a alguien al equipo no es un error de quien
// llama: sale como 500, sin el texto del driver. Caia en el 400 de siempre con
// la frase del pool ("failed to connect to ...") a la vista.
func TestResponderErrorDeEquipo_UnFalloDeLaBaseEs500(t *testing.T) {
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, "postgres://nadie@127.0.0.1:1/nada?connect_timeout=1")
	if err != nil {
		t.Fatalf("pool: %v", err)
	}
	defer pool.Close()
	_, err = NewRepository(pool).UpsertStaff(ctx,
		"00000000-0000-0000-0000-0000000000c1", "00000000-0000-0000-0000-000000000002",
		RoleCashier, "", "00000000-0000-0000-0000-000000000001")
	if err == nil {
		t.Fatal("sin base, UpsertStaff no fallo")
	}
	rec := httptest.NewRecorder()
	responderErrorDeEquipo(rec, "ADD_STAFF_FAILED", err)
	codigo, msg := codigoDe(t, rec)
	if rec.Code != http.StatusInternalServerError || codigo != "ADD_STAFF_FAILED" ||
		strings.Contains(msg, "127.0.0.1") || strings.Contains(msg, "connect") {
		t.Fatalf("%d %s %q, se esperaba 500 ADD_STAFF_FAILED sin el detalle", rec.Code, codigo, msg)
	}
}
