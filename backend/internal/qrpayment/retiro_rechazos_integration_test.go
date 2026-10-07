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

// Cada rechazo del retiro del saldo del negocio sale con su propio codigo. Salian
// como 400 WITHDRAW_FAILED con el texto del error tal cual ("insufficient
// business balance", "merchant not found"), y la pantalla lo mostraba en ingles.
func TestWithdrawMerchant_CadaRechazoSaleConSuCodigo(t *testing.T) {
	svc, _, payer, owner := setupQR(t)
	ctx := context.Background()

	qr := verifiedMerchantQR(t, svc, owner, 100000)
	if _, err := svc.ScanAndPay(ctx, payer, &qrpayment.ScanQRPaymentRequest{QRData: qr.QRData, Currency: "CRC"}); err != nil {
		t.Fatalf("ScanAndPay: %v", err)
	}

	h := qrpayment.NewHandler(svc)
	retirar := func(quien, cuerpo string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		h.WithdrawMerchant(rec, peticion(http.MethodPost,
			"/api/v1/qr/merchants/"+qr.MerchantID+"/withdraw", cuerpo, quien, qr.MerchantID))
		return rec
	}

	casos := []struct {
		nombre string
		quien  string
		cuerpo string
		estado int
		codigo string
	}{
		{"mas de lo que tiene el negocio", owner,
			`{"amount":50000000,"currency":"CRC","idempotency_key":"wd-rechazo-saldo"}`,
			http.StatusUnprocessableEntity, "MERCHANT_INSUFFICIENT_BALANCE"},
		{"un negocio que no es suyo", payer,
			`{"amount":1000,"currency":"CRC","idempotency_key":"wd-rechazo-ajeno"}`,
			http.StatusNotFound, "MERCHANT_NOT_FOUND"},
		{"sin monto", owner,
			`{"amount":0,"currency":"CRC","idempotency_key":"wd-rechazo-cero"}`,
			http.StatusBadRequest, "VALIDATION_ERROR"},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			rec := retirar(c.quien, c.cuerpo)
			var env struct {
				Error struct {
					Code    string `json:"code"`
					Message string `json:"message"`
				} `json:"error"`
			}
			if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
				t.Fatalf("decode %d: %v: %s", rec.Code, err, rec.Body.String())
			}
			if rec.Code != c.estado || env.Error.Code != c.codigo {
				t.Fatalf("= %d %q (%q), se esperaba %d %s", rec.Code, env.Error.Code, env.Error.Message, c.estado, c.codigo)
			}
			if strings.Contains(env.Error.Message, ":") {
				t.Fatalf("el texto lleva los prefijos internos: %q", env.Error.Message)
			}
		})
	}
}
