package qrpayment_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/kiramopay/backend/internal/qrpayment"
)

// El retiro del saldo del negocio con una llave que ya es de otro retiro. El
// handler respondia el 400 WITHDRAW_FAILED de cualquier fallo, asi que la
// pantalla no podia saber que esa llave ya no sirve y que el retiro nuevo
// necesita otra.
func TestWithdrawMerchant_LaMismaLlaveConOtroMontoEs409(t *testing.T) {
	svc, _, payer, owner := setupQR(t)
	ctx := context.Background()

	const monto int64 = 100000
	qr := verifiedMerchantQR(t, svc, owner, monto)
	if _, err := svc.ScanAndPay(ctx, payer, &qrpayment.ScanQRPaymentRequest{QRData: qr.QRData, Currency: "CRC"}); err != nil {
		t.Fatalf("ScanAndPay: %v", err)
	}

	h := qrpayment.NewHandler(svc)
	retirar := func(cuerpo string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		h.WithdrawMerchant(rec, peticion(http.MethodPost,
			"/api/v1/qr/merchants/"+qr.MerchantID+"/withdraw", cuerpo, owner, qr.MerchantID))
		return rec
	}

	if rec := retirar(`{"amount":30000,"currency":"CRC","idempotency_key":"wd-llave-otro-monto"}`); rec.Code != http.StatusNoContent {
		t.Fatalf("el retiro = %d: %s", rec.Code, rec.Body.String())
	}
	rec := retirar(`{"amount":40000,"currency":"CRC","idempotency_key":"wd-llave-otro-monto"}`)
	if rec.Code != http.StatusConflict || codigoDeError(t, rec) != "LLAVE_REUTILIZADA" {
		t.Fatalf("la misma llave con otro monto: %d %s, se esperaba 409 LLAVE_REUTILIZADA", rec.Code, rec.Body.String())
	}
}
