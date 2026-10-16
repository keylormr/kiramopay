package qrpayment_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/kiramopay/backend/internal/qrpayment"
)

func rechazoDe(t *testing.T, rec *httptest.ResponseRecorder) rechazoLeido {
	t.Helper()
	var env struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("respuesta ilegible %d: %v: %s", rec.Code, err, rec.Body.String())
	}
	return rechazoLeido{rec.Code, env.Error.Code, env.Error.Message}
}

// Pedir el codigo propio en una moneda que la billetera no maneja creaba un
// codigo que despues nadie podia pagar (el pago se cortaba en el tope, sin
// tope para esa moneda); y una moneda mas larga que la columna salia como 400
// PAYMENT_FAILED con el texto del driver. Las dos son un rechazo de la entrada,
// con su codigo.
func TestMiCodigo_UnaMonedaQueNoSeManejaTieneCodigoPropio(t *testing.T) {
	svc, _, payer, _ := setupQR(t)
	h := qrpayment.NewHandler(svc)

	for _, moneda := range []string{"XYZ", "MONEDA-LARGA-DE-MAS"} {
		rec := httptest.NewRecorder()
		h.GetMyCode(rec, peticion(http.MethodGet, "/api/v1/qr/my-code?currency="+moneda, "", payer, ""))
		r := rechazoDe(t, rec)
		if r.estado != http.StatusBadRequest || r.codigo != "UNSUPPORTED_CURRENCY" {
			t.Fatalf("%s = %d %s (%q), se esperaba 400 UNSUPPORTED_CURRENCY", moneda, r.estado, r.codigo, r.mensaje)
		}
	}

	// Las dos monedas de la billetera siguen sirviendo.
	for _, moneda := range []string{"CRC", "USD"} {
		rec := httptest.NewRecorder()
		h.GetMyCode(rec, peticion(http.MethodGet, "/api/v1/qr/my-code?currency="+moneda, "", payer, ""))
		if rec.Code != http.StatusOK {
			t.Fatalf("%s = %d: %s", moneda, rec.Code, rec.Body.String())
		}
	}
}

// El rotulo del mostrador respondia 400 PAYMENT_FAILED con la frase en ingles
// para todo: el comercio sin aprobar, uno ajeno o inexistente, la sucursal que
// no existe. La pantalla del negocio la pintaba tal cual.
func TestCodigoDelComercio_CadaRechazoTieneSuCodigo(t *testing.T) {
	svc, pool, payer, owner := setupQR(t)
	ctx := context.Background()
	h := qrpayment.NewHandler(svc)
	qr := verifiedMerchantQR(t, svc, owner, 5000)

	pedir := func(usuario, comercio, consulta string) rechazoLeido {
		rec := httptest.NewRecorder()
		h.GetMerchantCode(rec, peticion(http.MethodGet,
			"/api/v1/qr/merchants/"+comercio+"/code"+consulta, "", usuario, comercio))
		return rechazoDe(t, rec)
	}

	casos := []struct {
		nombre   string
		usuario  string
		comercio string
		consulta string
		estado   int
		codigo   string
	}{
		{"de otra persona", payer, qr.MerchantID, "", http.StatusNotFound, "MERCHANT_NOT_FOUND"},
		{"que no existe", owner, "00000000-0000-0000-0000-00000000dead", "", http.StatusNotFound, "MERCHANT_NOT_FOUND"},
		{"con una sucursal que no existe", owner, qr.MerchantID,
			"?location_id=00000000-0000-0000-0000-00000000beef", http.StatusNotFound, "LOCATION_NOT_FOUND"},
		{"en una moneda que no se maneja", owner, qr.MerchantID, "?currency=XYZ", http.StatusBadRequest, "UNSUPPORTED_CURRENCY"},
	}
	for _, c := range casos {
		r := pedir(c.usuario, c.comercio, c.consulta)
		if r.estado != c.estado || r.codigo != c.codigo {
			t.Errorf("%s = %d %s (%q), se esperaba %d %s", c.nombre, r.estado, r.codigo, r.mensaje, c.estado, c.codigo)
		}
	}

	// Sin aprobar: el mismo 409 que recibe quien le paga.
	if _, err := pool.Exec(ctx, `UPDATE qr_merchants SET verification_status = 'pending' WHERE id = $1::uuid`, qr.MerchantID); err != nil {
		t.Fatalf("dejar el comercio sin aprobar: %v", err)
	}
	if r := pedir(owner, qr.MerchantID, ""); r.estado != http.StatusConflict || r.codigo != "MERCHANT_UNAVAILABLE" {
		t.Fatalf("sin aprobar = %d %s (%q), se esperaba 409 MERCHANT_UNAVAILABLE", r.estado, r.codigo, r.mensaje)
	}
}

// Emitir un cobro sobre el rotulo de un comercio que dejo de estar aprobado
// salia 400 PAYMENT_FAILED "merchant is pending verification".
func TestCrearCobro_ComercioSinAprobarTieneCodigoPropio(t *testing.T) {
	svc, pool, _, owner := setupQR(t)
	ctx := context.Background()
	h := qrpayment.NewHandler(svc)
	qr := verifiedMerchantQR(t, svc, owner, 5000)
	rotulo, err := svc.GetOrCreateMerchantCode(ctx, owner, qr.MerchantID, "", "CRC")
	if err != nil {
		t.Fatalf("rotulo: %v", err)
	}
	if _, err := pool.Exec(ctx, `UPDATE qr_merchants SET verification_status = 'pending' WHERE id = $1::uuid`, qr.MerchantID); err != nil {
		t.Fatalf("dejar el comercio sin aprobar: %v", err)
	}

	rec := httptest.NewRecorder()
	h.CreateCharge(rec, peticion(http.MethodPost, "/api/v1/qr/charges",
		`{"qr_code_id":"`+rotulo.ID+`","amount":5000}`, owner, ""))
	r := rechazoDe(t, rec)
	if r.estado != http.StatusConflict || r.codigo != "MERCHANT_UNAVAILABLE" {
		t.Fatalf("= %d %s (%q), se esperaba 409 MERCHANT_UNAVAILABLE", r.estado, r.codigo, r.mensaje)
	}
}

// Pagar un codigo en una moneda sin tope (uno creado antes de que se validara
// la moneda) caia al 500: la pantalla decia "no pudimos confirmar el pago" por
// un rechazo en el que no se movio nada. Tiene su codigo, y no mueve dinero.
func TestPagar_UnCodigoEnUnaMonedaSinTopeTieneCodigoPropio(t *testing.T) {
	svc, pool, payer, owner := setupQR(t)
	ctx := context.Background()
	code, err := qrpayment.NewRepository(pool).GetOrCreateStaticCode(ctx, owner, "", "", "EUR", "p2p_receive")
	if err != nil {
		t.Fatalf("codigo en EUR: %v", err)
	}
	antes := walletCRC(t, pool, payer)

	rec := httptest.NewRecorder()
	qrpayment.NewHandler(svc).ScanAndPay(rec, peticion(http.MethodPost, "/api/v1/qr/pay",
		`{"qr_data":"`+code.QRData+`","amount":5000,"currency":"CRC","idempotency_key":"nonce-eur-1"}`, payer, ""))
	r := rechazoDe(t, rec)
	if r.estado != http.StatusUnprocessableEntity || r.codigo != "UNSUPPORTED_CURRENCY" {
		t.Fatalf("= %d %s (%q), se esperaba 422 UNSUPPORTED_CURRENCY", r.estado, r.codigo, r.mensaje)
	}
	if strings.Contains(r.mensaje, ":") {
		t.Fatalf("el texto lleva los prefijos internos: %q", r.mensaje)
	}
	if got := walletCRC(t, pool, payer); got != antes {
		t.Fatalf("saldo = %d, se esperaba %d", got, antes)
	}
}
