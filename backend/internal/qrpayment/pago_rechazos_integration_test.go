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

type rechazoLeido struct {
	estado  int
	codigo  string
	mensaje string
}

func pagarPorLaRuta(t *testing.T, svc *qrpayment.Service, payer, qrData string) rechazoLeido {
	t.Helper()
	rec := httptest.NewRecorder()
	qrpayment.NewHandler(svc).ScanAndPay(rec, peticion(http.MethodPost, "/api/v1/qr/pay",
		`{"qr_data":"`+qrData+`","currency":"CRC"}`, payer, ""))
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

// Pagar por QR sin saldo, por encima de un tope o a un comercio que no esta
// habilitado salia como 400 PAYMENT_FAILED con el texto del error tal cual
// ("qr payment transfer: insufficient balance", "merchant is not available"):
// la pantalla lo mostraba en ingles y no podia decir que hacer. Cada rechazo
// sale ahora con su codigo, el mismo que usa SINPE para el mismo motivo.
func TestScanAndPay_CadaRechazoSaleConSuCodigo(t *testing.T) {
	svc, pool, payer, owner := setupQR(t)
	ctx := context.Background()
	qr := verifiedMerchantQR(t, svc, owner, 5000)

	casos := []struct {
		nombre   string
		ajuste   string // $1: el id de quien paga, o el del comercio si delComercio
		deshacer string
		comercio bool
		estado   int
		codigo   string
	}{
		{"sin saldo",
			`UPDATE wallets SET balance_crc = 100 WHERE user_id = $1::uuid`,
			`UPDATE wallets SET balance_crc = 250000000 WHERE user_id = $1::uuid`,
			false, http.StatusUnprocessableEntity, "INSUFFICIENT_BALANCE"},
		{"por encima del tope diario",
			`UPDATE wallets SET daily_limit = 1000 WHERE user_id = $1::uuid`,
			`UPDATE wallets SET daily_limit = 100000000 WHERE user_id = $1::uuid`,
			false, http.StatusUnprocessableEntity, "DAILY_LIMIT_EXCEEDED"},
		{"por encima del tope mensual",
			`UPDATE wallets SET monthly_limit = 1000 WHERE user_id = $1::uuid`,
			`UPDATE wallets SET monthly_limit = 500000000 WHERE user_id = $1::uuid`,
			false, http.StatusUnprocessableEntity, "MONTHLY_LIMIT_EXCEEDED"},
		{"un comercio que todavia no esta aprobado",
			`UPDATE qr_merchants SET verification_status = 'pending' WHERE id = $1::uuid`,
			`UPDATE qr_merchants SET verification_status = 'verified' WHERE id = $1::uuid`,
			true, http.StatusConflict, "MERCHANT_UNAVAILABLE"},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			id := payer
			if c.comercio {
				id = qr.MerchantID
			}
			if _, err := pool.Exec(ctx, c.ajuste, id); err != nil {
				t.Fatalf("ajuste: %v", err)
			}
			t.Cleanup(func() {
				if _, err := pool.Exec(ctx, c.deshacer, id); err != nil {
					t.Errorf("deshacer: %v", err)
				}
			})

			r := pagarPorLaRuta(t, svc, payer, qr.QRData)
			if r.estado != c.estado || r.codigo != c.codigo {
				t.Fatalf("= %d %s (%q), se esperaba %d %s", r.estado, r.codigo, r.mensaje, c.estado, c.codigo)
			}
			if strings.Contains(r.mensaje, ":") {
				t.Fatalf("el texto lleva los prefijos internos: %q", r.mensaje)
			}
		})
	}

	// Ninguno movio dinero: el saldo de quien paga sigue entero.
	if got := walletCRC(t, pool, payer); got != 250000000 {
		t.Fatalf("saldo de quien paga = %d, se esperaba 250000000", got)
	}
}

// Lo que el servidor no reconoce es un fallo suyo, y el pago pudo haber salido
// (un commit que se corta termina aqui): 500, con el detalle en el log y no en
// la respuesta. Salia 400 PAYMENT_FAILED con el error tal cual, y la pantalla,
// tomandolo por un rechazo, soltaba la llave: el reintento era otro pago. Se
// simula con la billetera de quien paga borrada.
func TestScanAndPay_LoQueNoSeReconoceEsUn500SinElDetalle(t *testing.T) {
	svc, pool, payer, owner := setupQR(t)
	qr := verifiedMerchantQR(t, svc, owner, 5000)
	if _, err := pool.Exec(context.Background(), `DELETE FROM wallets WHERE user_id = $1::uuid`, payer); err != nil {
		t.Fatalf("borrar la billetera: %v", err)
	}

	r := pagarPorLaRuta(t, svc, payer, qr.QRData)
	if r.estado != http.StatusInternalServerError || r.codigo != "PAYMENT_FAILED" {
		t.Fatalf("= %d %s (%q), se esperaba 500 PAYMENT_FAILED", r.estado, r.codigo, r.mensaje)
	}
	if strings.Contains(r.mensaje, "wallet") {
		t.Fatalf("la respuesta lleva el detalle interno: %q", r.mensaje)
	}
}
