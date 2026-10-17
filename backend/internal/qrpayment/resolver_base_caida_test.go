package qrpayment_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/kiramopay/backend/internal/qrpayment"
)

// servicioSinBase arma el servicio contra una base que no contesta: el pool de
// pgx no se conecta al crearse, solo al usarse, y el puerto 1 de la propia
// maquina rechaza la conexion. Cada consulta falla como falla una caida de la
// base, sin necesitar una base de pruebas.
func servicioSinBase(t *testing.T) *qrpayment.Service {
	t.Helper()
	pool, err := pgxpool.New(context.Background(),
		"postgres://nadie:nada@127.0.0.1:1/nada?sslmode=disable&connect_timeout=2")
	if err != nil {
		t.Fatalf("armar el pool: %v", err)
	}
	t.Cleanup(pool.Close)
	return qrpayment.NewService(qrpayment.NewRepository(pool), nil, nil, nil)
}

// errorDeLaRespuesta lee el codigo y el texto del sobre de error.
func errorDeLaRespuesta(t *testing.T, rec *httptest.ResponseRecorder) (string, string) {
	t.Helper()
	var sobre struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &sobre); err != nil {
		t.Fatalf("respuesta ilegible %d: %v: %s", rec.Code, err, rec.Body.String())
	}
	return sobre.Error.Code, sobre.Error.Message
}

// Las tres formas que tiene un codigo escaneado: la identidad permanente (i…),
// el cobro (x…) y la fila vieja de 24 hexadecimales.
var payloadsDeCadaForma = []struct{ nombre, qrData string }{
	{"identidad permanente", "KP:p2p_receive:abcd1234:0:CRC:iffffffffffffffffffffffff"},
	{"cobro", "KP:p2p_request:abcd1234:500000:CRC:xffffffffffffffffffffffff"},
	{"fila vieja", "KP:p2p_request:abcd1234:500000:CRC:" + strings.Repeat("ab", 12)},
}

// Resolver un QR con la base caida contestaba 400 QR_INVALIDO: la pantalla le
// decia a la persona que el codigo no existe o ya no es valido, y una caida
// pasajera se leia como un codigo malo, que no tiene sentido volver a escanear.
// No encontrado es QR_INVALIDO; no poder leerlo es un fallo del servidor: 500,
// con su codigo y sin el detalle de la base en la respuesta.
func TestResolveQR_LaBaseCaidaEsUn500SinDetalle(t *testing.T) {
	h := qrpayment.NewHandler(servicioSinBase(t))
	for _, c := range payloadsDeCadaForma {
		t.Run(c.nombre, func(t *testing.T) {
			rec := httptest.NewRecorder()
			h.ResolveQR(rec, peticion(http.MethodPost, "/api/v1/qr/resolve",
				`{"qr_data":"`+c.qrData+`"}`, "user-1", ""))
			codigo, mensaje := errorDeLaRespuesta(t, rec)
			if rec.Code != http.StatusInternalServerError || codigo != "RESOLVE_FAILED" {
				t.Fatalf("= %d %s (%q), se esperaba 500 RESOLVE_FAILED", rec.Code, codigo, mensaje)
			}
			if mensaje != "internal server error" {
				t.Fatalf("la respuesta lleva el detalle interno: %q", mensaje)
			}
		})
	}
}

// El pago y el envio de cripto resuelven el codigo con la misma funcion. Con la
// base caida tampoco pueden decir que el codigo no sirve: el pago sale como su
// 500 (la pantalla lo dice sin confirmar y conserva la llave) y el envio de
// cripto como el suyo.
func TestResolverQR_LaBaseCaidaNoEsUnCodigoInvalidoAlPagarNiAlEnviar(t *testing.T) {
	svc := servicioSinBase(t)
	for _, c := range payloadsDeCadaForma {
		t.Run(c.nombre, func(t *testing.T) {
			rec := httptest.NewRecorder()
			qrpayment.NewHandler(svc).ScanAndPay(rec, peticion(http.MethodPost, "/api/v1/qr/pay",
				`{"qr_data":"`+c.qrData+`","amount":1000,"currency":"CRC"}`, "user-1", ""))
			if codigo, mensaje := errorDeLaRespuesta(t, rec); rec.Code != http.StatusInternalServerError || codigo != "PAYMENT_FAILED" {
				t.Fatalf("pagar = %d %s (%q), se esperaba 500 PAYMENT_FAILED", rec.Code, codigo, mensaje)
			}

			_, err := svc.PersonaDelQR(context.Background(), c.qrData)
			if err == nil || errors.Is(err, qrpayment.ErrQRInvalido) {
				t.Fatalf("PersonaDelQR = %v, se esperaba el fallo de la base y no ErrQRInvalido", err)
			}
		})
	}
}
