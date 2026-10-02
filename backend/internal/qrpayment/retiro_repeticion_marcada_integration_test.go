package qrpayment_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/kiramopay/backend/internal/contract"
	"github.com/kiramopay/backend/internal/qrpayment"
)

// El retiro del saldo del negocio respondia 204 sin cuerpo, el nuevo y la
// repeticion por igual. La pantalla conserva la llave del retiro mientras no
// sabe que paso, asi que al dueño que retiraba otra vez, a proposito, el mismo
// monto le decia "listo" por un retiro que el servidor no hizo. Ahora la
// respuesta dice que retiro fue y, si ya estaba hecho, lo marca con
// `replayed: true`. Solo la repeticion trae la clave.

// retiroLeido es lo que la pantalla lee de un retiro que salio bien.
type retiroLeido struct {
	id       string
	marcado  bool
	conClave bool
	data     any
}

// leerRetiro exige el 200 y lee el id y la marca de la respuesta.
func leerRetiro(t *testing.T, rec *httptest.ResponseRecorder) retiroLeido {
	t.Helper()
	if rec.Code != http.StatusOK {
		t.Fatalf("respuesta = %d, se esperaba 200: %s", rec.Code, rec.Body.String())
	}
	var sobre struct {
		Data json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &sobre); err != nil {
		t.Fatalf("la respuesta no es JSON: %s", rec.Body.String())
	}
	var campos map[string]json.RawMessage
	if err := json.Unmarshal(sobre.Data, &campos); err != nil || campos == nil {
		t.Fatalf("la respuesta no trae data: %s", rec.Body.String())
	}
	var r retiroLeido
	if err := json.Unmarshal(campos["transaction_id"], &r.id); err != nil || r.id == "" {
		t.Fatalf("la respuesta no trae transaction_id: %s", rec.Body.String())
	}
	if crudo, ok := campos["replayed"]; ok {
		r.conClave = true
		r.marcado = string(crudo) == "true"
	}
	if err := json.Unmarshal(sobre.Data, &r.data); err != nil {
		t.Fatalf("decodificar data: %v", err)
	}
	return r
}

// retiroCumpleElContrato valida cada respuesta contra el esquema publicado y
// exige que el esquema documente la marca.
func retiroCumpleElContrato(t *testing.T, merchantID string, retiros ...retiroLeido) {
	t.Helper()
	doc, err := contract.LoadSpec("../../docs/openapi.yaml")
	if err != nil {
		t.Fatalf("cargar el contrato: %v", err)
	}
	router, err := contract.NewRouter(doc)
	if err != nil {
		t.Fatalf("router del contrato: %v", err)
	}
	url := "http://localhost:8080/api/v1/qr/merchants/" + merchantID + "/withdraw"
	for _, r := range retiros {
		if err := contract.ValidateData(router, http.MethodPost, url, http.StatusOK, r.data); err != nil {
			t.Errorf("la respuesta no cumple MerchantWithdrawal: %v", err)
		}
	}
	s := doc.Components.Schemas["MerchantWithdrawal"]
	if s == nil || s.Value == nil {
		t.Fatalf("el contrato no tiene MerchantWithdrawal")
	}
	marca := s.Value.Properties["replayed"]
	if marca == nil || marca.Value == nil || !marca.Value.Type.Is("boolean") {
		t.Errorf("MerchantWithdrawal no documenta replayed como booleano")
	}
}

func TestWithdrawMerchant_LaRepeticionLoDiceYElRetiroNuevoNo(t *testing.T) {
	svc, _, payer, owner := setupQR(t)
	ctx := context.Background()

	qr := verifiedMerchantQR(t, svc, owner, 100000)
	if _, err := svc.ScanAndPay(ctx, payer, &qrpayment.ScanQRPaymentRequest{QRData: qr.QRData, Currency: "CRC"}); err != nil {
		t.Fatalf("ScanAndPay: %v", err)
	}

	h := qrpayment.NewHandler(svc)
	retirar := func() *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		h.WithdrawMerchant(rec, peticion(http.MethodPost,
			"/api/v1/qr/merchants/"+qr.MerchantID+"/withdraw",
			`{"amount":30000,"currency":"CRC","idempotency_key":"wd-marca"}`, owner, qr.MerchantID))
		return rec
	}

	nuevo := leerRetiro(t, retirar())
	repetido := leerRetiro(t, retirar())

	if nuevo.conClave {
		t.Errorf("el retiro nuevo trae la clave replayed: %v", nuevo.data)
	}
	if !repetido.marcado {
		t.Errorf("la repeticion no trae replayed: true: %v", repetido.data)
	}
	if repetido.id != nuevo.id {
		t.Errorf("la repeticion devolvio %s, el retiro fue %s", repetido.id, nuevo.id)
	}
	retiroCumpleElContrato(t, qr.MerchantID, nuevo, repetido)
}
