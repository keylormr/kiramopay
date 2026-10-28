package crypto_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/kiramopay/backend/internal/crypto"
	"github.com/kiramopay/backend/internal/middleware"
)

// Defectos del servidor que encontro un recorrido automatico de la app contra
// el servidor real (cripto, pasos de "casos limite por API"):
//
//   - enviar una cantidad que vale menos de un centavo respondia 500: el valor
//     en dolares se redondea a cero y la fila del historial no entra
//     (chk_tx_amount_positive);
//   - convertir un activo en si mismo respondia 201 y dejaba un movimiento que
//     no cambiaba ningun saldo;
//   - el simbolo en minusculas respondia 503 PRICE_UNAVAILABLE, como si el
//     proveedor de precios estuviera caido.
//
// El feed cotiza todo a 1000 dolares y el tipo de cambio es 500.

// codigoYEstado lee el codigo de error de una respuesta del servidor.
func codigoYEstado(t *testing.T, rec *httptest.ResponseRecorder) (int, string) {
	t.Helper()
	var cuerpo struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &cuerpo); err != nil {
		t.Fatalf("la respuesta no es JSON: %s", rec.Body.String())
	}
	return rec.Code, cuerpo.Error.Code
}

// exigirRechazo exige el estado y el codigo exactos, y que la respuesta no
// deje ver nada de la base.
func exigirRechazo(t *testing.T, rec *httptest.ResponseRecorder, estado int, codigo string) {
	t.Helper()
	gotEstado, gotCodigo := codigoYEstado(t, rec)
	if gotEstado != estado || gotCodigo != codigo {
		t.Fatalf("respuesta = %d %s, se esperaba %d %s: %s", gotEstado, gotCodigo, estado, codigo, rec.Body.String())
	}
	sinRastroDeLaBase(t, rec.Body.String())
}

func (e *entornoDeEnvio) enviarCuerpoPorHTTP(cuerpo string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, urlEnviar, bytes.NewReader([]byte(cuerpo)))
	req = req.WithContext(context.WithValue(req.Context(), middleware.UserIDKey, e.quienEnvia))
	rec := httptest.NewRecorder()
	crypto.NewHandler(e.svc).Send(rec, req)
	return rec
}

// ── Enviar una cantidad que no vale un centavo ──────────────────────────────

// 0,00000001 BTC a 1000 dolares valen 0,00001 dolares: al centimo son cero. El
// historial del envio no puede guardar una fila de monto cero, y antes de
// mover nada hay que decirlo: un 4xx con el codigo de monto invalido, sin
// saldo movido, sin comision y sin fila.
func TestEnviar_UnaCantidadQueNoValeUnCentavoSeRechazaSinMoverNada(t *testing.T) {
	e := montarEnvio(t)

	rec := e.enviarCuerpoPorHTTP(fmt.Sprintf(
		`{"asset":"BTC","amount":0.00000001,"qr_data":%q,"price":1000}`, e.qrDelReceptor))

	exigirRechazo(t, rec, http.StatusBadRequest, "CRYPTO_INVALID_AMOUNT")
	e.exigirQueNadaSeMovio(t)
}

// El mismo rechazo con el simbolo en minusculas: normalizar el simbolo no
// puede abrir un camino que se salte la comprobacion.
func TestEnviar_UnaCantidadQueNoValeUnCentavoConElSimboloEnMinusculas(t *testing.T) {
	e := montarEnvio(t)

	rec := e.enviarCuerpoPorHTTP(fmt.Sprintf(
		`{"asset":"btc","amount":0.00000001,"qr_data":%q,"price":1000}`, e.qrDelReceptor))

	exigirRechazo(t, rec, http.StatusBadRequest, "CRYPTO_INVALID_AMOUNT")
	e.exigirQueNadaSeMovio(t)
}

// Comprar, vender y convertir ya rechazaban lo que no llega a un centimo:
// esta prueba fija que el riesgo del envio no esta en ellas. Comprar y vender
// escriben una fila en `transactions` con el monto en colones, y convertir no
// escribe ninguna.
func TestCripto_ComprarVenderYConvertirRechazanLoQueNoLlegaAUnCentimo(t *testing.T) {
	casos := []struct {
		nombre  string
		url     string
		cuerpo  string
		atender func(*montajeVenta) http.HandlerFunc
	}{
		// 0,004 colones son cero centimos.
		{"comprar", urlComprar, `{"asset":"BTC","from_currency":"CRC","from_amount":0.004}`,
			func(m *montajeVenta) http.HandlerFunc { return m.h.Buy }},
		// 0,000000001 BTC a 500.000 colones valen 0,0005 colones.
		{"vender", urlVender, `{"asset":"BTC","amount":0.000000001,"to_currency":"CRC"}`,
			func(m *montajeVenta) http.HandlerFunc { return m.h.Sell }},
		// 1e-18 BTC por 1000 entre 1000 da menos de lo que la cuenta guarda.
		{"convertir", urlConvertir, `{"from_asset":"BTC","to_asset":"ETH","from_amount":0.000000000000000001}`,
			func(m *montajeVenta) http.HandlerFunc { return m.h.Convert }},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			m := montarVenta(t)
			m.sembrar(t, "BTC", "Bitcoin", 1)

			rec := m.porHTTP(c.url, c.atender(m), c.cuerpo)

			exigirRechazo(t, rec, http.StatusBadRequest, "CRYPTO_INVALID_AMOUNT")
			m.exigirSaldo(t, "BTC", 1, "un rechazo no mueve el saldo")
			if n := m.contar(t, `SELECT COUNT(*) FROM crypto_transactions`); n != 0 {
				t.Fatalf("un rechazo dejo %d movimientos de cripto", n)
			}
		})
	}
}

// ── Convertir un activo en si mismo ─────────────────────────────────────────

// ETH a ETH respondia 201 y quedaba en el historial como una conversion hecha,
// sin cambiar ningun saldo. Es un par que no existe: 400, y nada se anota.
func TestConvertir_UnActivoEnSiMismoSeRechaza(t *testing.T) {
	casos := map[string]string{
		"mismo activo": `{"from_asset":"ETH","to_asset":"ETH","from_amount":0.001}`,
		// Las minusculas son el mismo activo.
		"origen en minusculas":  `{"from_asset":"eth","to_asset":"ETH","from_amount":0.001}`,
		"destino en minusculas": `{"from_asset":"ETH","to_asset":"eth","from_amount":0.001}`,
	}
	for nombre, cuerpo := range casos {
		t.Run(nombre, func(t *testing.T) {
			m := montarVenta(t)
			m.sembrar(t, "ETH", "Ethereum", 1)

			rec := m.convertirPorHTTP(cuerpo)

			exigirRechazo(t, rec, http.StatusBadRequest, "CRYPTO_INVALID_PAIR")
			m.exigirSaldo(t, "ETH", 1, "convertir un activo en si mismo no mueve nada")
			if n := m.conversionesAnotadas(t); n != 0 {
				t.Fatalf("quedaron %d conversiones anotadas", n)
			}
		})
	}
}

// ── El simbolo en minusculas ────────────────────────────────────────────────

// Un simbolo mal escrito no es un proveedor de precios caido: comprar con
// "btc" opera con BTC, y el movimiento queda anotado con el simbolo en
// mayusculas, que es como lo busca todo lo demas.
func TestComprar_ElSimboloEnMinusculasSeNormaliza(t *testing.T) {
	m := montarVenta(t)

	rec := m.porHTTP(urlComprar, m.h.Buy, `{"asset":" btc ","from_currency":"CRC","from_amount":50000}`)

	if rec.Code != http.StatusCreated {
		t.Fatalf("respuesta = %d, se esperaba 201: %s", rec.Code, rec.Body.String())
	}
	var cuerpo struct {
		Data struct {
			Asset string `json:"asset"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &cuerpo); err != nil || cuerpo.Data.Asset != "BTC" {
		t.Fatalf("la compra quedo anotada con el activo %q, se esperaba BTC: %s", cuerpo.Data.Asset, rec.Body.String())
	}
	// 50.000 colones a 500.000 la unidad compran 0,1.
	m.exigirSaldo(t, "BTC", 0.1, "el saldo va en la fila BTC")
}

func TestVender_ElSimboloEnMinusculasSeNormaliza(t *testing.T) {
	m := montarVenta(t)
	m.sembrar(t, "BTC", "Bitcoin", 1)

	rec := m.porHTTP(urlVender, m.h.Sell, `{"asset":"btc","amount":0.25,"to_currency":"CRC"}`)

	if rec.Code != http.StatusCreated {
		t.Fatalf("respuesta = %d, se esperaba 201: %s", rec.Code, rec.Body.String())
	}
	m.exigirSaldo(t, "BTC", 0.75, "se vendio un cuarto de BTC")
}

func TestConvertir_LosSimbolosEnMinusculasSeNormalizan(t *testing.T) {
	m := montarVenta(t)
	m.sembrar(t, "BTC", "Bitcoin", 1)

	rec := m.convertirPorHTTP(`{"from_asset":"btc","to_asset":"eth","from_amount":0.5}`)

	if rec.Code != http.StatusCreated {
		t.Fatalf("respuesta = %d, se esperaba 201: %s", rec.Code, rec.Body.String())
	}
	m.exigirSaldo(t, "BTC", 0.5, "salio medio BTC")
	// Uno a uno: el feed cotiza todo a 1000 dolares.
	m.exigirSaldo(t, "ETH", 0.5, "llego medio ETH")
}

func TestApartar_ElSimboloEnMinusculasSeNormaliza(t *testing.T) {
	m := montarVenta(t)
	m.sembrar(t, "ETH", "Ethereum", 3)

	rec := m.apartarPorHTTP(`{"asset":"eth","amount":1,"locked":false}`)

	if rec.Code != http.StatusCreated {
		t.Fatalf("respuesta = %d, se esperaba 201: %s", rec.Code, rec.Body.String())
	}
	m.exigirSaldo(t, "ETH", 2, "se aparto un ETH")
	if n := m.contar(t, `SELECT COUNT(*) FROM crypto_staking WHERE user_id = $1::uuid AND asset = 'ETH'`, m.userID); n != 1 {
		t.Fatalf("posiciones de ETH = %d, se esperaba 1", n)
	}
}

// El envio ya normalizaba; se fija para que siga igual.
func TestEnviar_ElSimboloEnMinusculasSeNormaliza(t *testing.T) {
	e := montarEnvio(t)

	rec := e.enviarCuerpoPorHTTP(fmt.Sprintf(
		`{"asset":"btc","amount":0.08,"qr_data":%q,"price":1000}`, e.qrDelReceptor))

	if rec.Code != http.StatusCreated {
		t.Fatalf("respuesta = %d, se esperaba 201: %s", rec.Code, rec.Body.String())
	}
	e.exigirSaldos(t, d(1).Sub(bajaDelSaldo), seEnvia)
}

// La lista de precios de la pantalla (?symbols=btc,eth) tambien se escribe a
// mano: los precios salen con el simbolo en mayusculas, que es la llave con la
// que la pantalla los busca.
func TestPrecios_LosSimbolosEnMinusculasSeNormalizan(t *testing.T) {
	svc, _ := setupCryptoService(t)

	precios, err := svc.GetPrices(context.Background(), []string{"btc", " eth "})
	if err != nil {
		t.Fatalf("GetPrices: %v", err)
	}
	for _, simbolo := range []string{"BTC", "ETH"} {
		if p, ok := precios[simbolo]; !ok || p.Price <= 0 {
			t.Fatalf("falta el precio de %s en %v", simbolo, precios)
		}
	}
}
