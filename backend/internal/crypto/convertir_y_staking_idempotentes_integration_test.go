package crypto_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/kiramopay/backend/internal/crypto"
	"github.com/kiramopay/backend/internal/middleware"
)

// Convertir y apartar para staking no tenian llave de idempotencia. Comprar,
// vender y enviar la tienen; estas dos iban directo a su transaccion del
// repositorio sin preguntar por ninguna, asi que un doble toque —o la red que
// se corta sin traer la respuesta y el telefono que reintenta— convertia dos
// veces o apartaba dos veces. Y no hay asiento del libro que lo delate: los
// activos viven en crypto_assets, fuera de la doble partida.
//
// Las pruebas van por el handler, como la pantalla, con la llave en el cuerpo.
// El feed cotiza todo a 1000 dolares, asi que convertir BTC en ETH es uno a uno.

const (
	urlConvertir = "http://localhost:8080/api/v1/crypto/convert"
	urlApartar   = "http://localhost:8080/api/v1/crypto/staking"

	convertirUnBTC = `{"from_asset":"BTC","to_asset":"ETH","from_amount":1,"idempotency_key":"crypto:convert:toque-1"}`
	apartarUnETH   = `{"asset":"ETH","amount":1,"locked":false,"idempotency_key":"crypto:stake:toque-1"}`
)

func (m *montajeVenta) sembrar(t *testing.T, simbolo, nombre string, cantidad float64) {
	t.Helper()
	if err := crypto.NewRepository(m.pool).UpsertAsset(context.Background(),
		m.userID, simbolo, nombre, d(cantidad), d(1000)); err != nil {
		t.Fatalf("sembrar %s: %v", simbolo, err)
	}
}

// porHTTP no llama a t.Fatalf: las pruebas de toques simultaneos la corren
// desde otras goroutines.
func (m *montajeVenta) porHTTP(url string, atender http.HandlerFunc, cuerpo string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, url, strings.NewReader(cuerpo))
	req = req.WithContext(context.WithValue(req.Context(), middleware.UserIDKey, m.userID))
	rec := httptest.NewRecorder()
	atender(rec, req)
	return rec
}

func (m *montajeVenta) convertirPorHTTP(cuerpo string) *httptest.ResponseRecorder {
	return m.porHTTP(urlConvertir, m.h.Convert, cuerpo)
}

func (m *montajeVenta) apartarPorHTTP(cuerpo string) *httptest.ResponseRecorder {
	return m.porHTTP(urlApartar, m.h.Stake, cuerpo)
}

// idCreado exige un 201 y devuelve el id de lo que se creo.
func idCreado(t *testing.T, rec *httptest.ResponseRecorder) string {
	t.Helper()
	if rec.Code != http.StatusCreated {
		t.Fatalf("respuesta = %d, se esperaba 201: %s", rec.Code, rec.Body.String())
	}
	var cuerpo struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &cuerpo); err != nil || cuerpo.Data.ID == "" {
		t.Fatalf("la respuesta no trae id: %s", rec.Body.String())
	}
	return cuerpo.Data.ID
}

// exigirLlaveReutilizada exige el 409 con el codigo que la pantalla ya sabe
// explicar.
func exigirLlaveReutilizada(t *testing.T, rec *httptest.ResponseRecorder) {
	t.Helper()
	var cuerpo struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &cuerpo)
	if rec.Code != http.StatusConflict || cuerpo.Error.Code != "LLAVE_REUTILIZADA" {
		t.Fatalf("respuesta = %d %s, se esperaba 409 LLAVE_REUTILIZADA", rec.Code, rec.Body.String())
	}
	sinRastroDeLaBase(t, rec.Body.String())
}

func (m *montajeVenta) exigirSaldo(t *testing.T, simbolo string, quiere float64, porque string) {
	t.Helper()
	if got := saldoDelActivo(t, m, simbolo); !got.Equal(d(quiere)) {
		t.Fatalf("%s = %s, se esperaba %v: %s", simbolo, got, quiere, porque)
	}
}

func (m *montajeVenta) conversionesAnotadas(t *testing.T) int {
	t.Helper()
	return m.contar(t,
		`SELECT COUNT(*) FROM crypto_transactions WHERE user_id = $1::uuid AND type = 'convert'`, m.userID)
}

func (m *montajeVenta) posicionesDeStaking(t *testing.T) int {
	t.Helper()
	return m.contar(t, `SELECT COUNT(*) FROM crypto_staking WHERE user_id = $1::uuid`, m.userID)
}

// aLaVez manda la misma llamada varias veces, soltandolas juntas.
func aLaVez(veces int, llamar func() *httptest.ResponseRecorder) []*httptest.ResponseRecorder {
	recs := make([]*httptest.ResponseRecorder, veces)
	salida := make(chan struct{})
	var wg sync.WaitGroup
	for i := range recs {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-salida
			recs[i] = llamar()
		}(i)
	}
	close(salida)
	wg.Wait()
	return recs
}

// ── Convertir ───────────────────────────────────────────────────────────────

// El doble toque: la misma conversion llega dos veces con la misma llave. La
// segunda tiene que devolver la primera, no convertir otra vez.
func TestConvertir_ElReintentoConLaMismaLlaveConvierteUnaVez(t *testing.T) {
	m := montarVenta(t)
	m.sembrar(t, "BTC", "Bitcoin", 3)

	primera := idCreado(t, m.convertirPorHTTP(convertirUnBTC))
	segunda := idCreado(t, m.convertirPorHTTP(convertirUnBTC))

	if segunda != primera {
		t.Errorf("el reintento escribio otra conversion (%s vs %s)", segunda, primera)
	}
	m.exigirSaldo(t, "BTC", 2, "el reintento volvio a descontar el activo de origen")
	m.exigirSaldo(t, "ETH", 1, "el reintento volvio a abonar el activo de destino")
	if n := m.conversionesAnotadas(t); n != 1 {
		t.Fatalf("conversiones anotadas = %d, se esperaba 1", n)
	}
}

// La llave la elige el cliente, asi que puede llegar repetida describiendo otra
// conversion. No es un reintento: devolver la vieja seria contestar "listo" por
// algo que no se hizo, y hacer la nueva seria gastar la misma llave dos veces.
func TestConvertir_LaMismaLlaveParaOtraConversionSeRechaza(t *testing.T) {
	for _, c := range []struct{ nombre, cuerpo string }{
		{"otra cantidad",
			`{"from_asset":"BTC","to_asset":"ETH","from_amount":0.5,"idempotency_key":"crypto:convert:toque-1"}`},
		{"otro destino",
			`{"from_asset":"BTC","to_asset":"SOL","from_amount":1,"idempotency_key":"crypto:convert:toque-1"}`},
	} {
		t.Run(c.nombre, func(t *testing.T) {
			m := montarVenta(t)
			m.sembrar(t, "BTC", "Bitcoin", 3)

			idCreado(t, m.convertirPorHTTP(convertirUnBTC))
			exigirLlaveReutilizada(t, m.convertirPorHTTP(c.cuerpo))

			m.exigirSaldo(t, "BTC", 2, "la segunda conversion no debia ocurrir")
			if n := m.conversionesAnotadas(t); n != 1 {
				t.Fatalf("conversiones anotadas = %d, se esperaba 1", n)
			}
		})
	}
}

// Con TODO el saldo convertido, el reintento ya no tiene de donde descontar, y
// la comprobacion de saldo contestaba "no te alcanza" por una conversion que SI
// se hizo: la persona veria un error y creeria que no convirtio.
func TestConvertir_ElReintentoConElSaldoAgotadoDevuelveLaConversion(t *testing.T) {
	m := montarVenta(t)
	m.sembrar(t, "BTC", "Bitcoin", 1)

	primera := idCreado(t, m.convertirPorHTTP(convertirUnBTC))
	rec := m.convertirPorHTTP(convertirUnBTC)
	if rec.Code != http.StatusCreated {
		t.Fatalf("el reintento de una conversion que ya se hizo = %d %s, se esperaba 201 con la misma conversion",
			rec.Code, rec.Body.String())
	}
	if segunda := idCreado(t, rec); segunda != primera {
		t.Errorf("el reintento devolvio otra conversion (%s vs %s)", segunda, primera)
	}
	m.exigirSaldo(t, "BTC", 0, "se convirtio una sola vez todo el saldo")
	m.exigirSaldo(t, "ETH", 1, "se convirtio una sola vez todo el saldo")
}

// Los dos toques en vuelo al mismo tiempo. Aqui el saldo alcanza para los dos,
// asi que la guarda del descuento no frena nada: lo unico que puede frenar el
// segundo es la llave.
func TestConvertir_DosToquesSimultaneosConviertenUnaVez(t *testing.T) {
	m := montarVenta(t)
	m.sembrar(t, "BTC", "Bitcoin", 3)

	recs := aLaVez(2, func() *httptest.ResponseRecorder { return m.convertirPorHTTP(convertirUnBTC) })

	a, b := idCreado(t, recs[0]), idCreado(t, recs[1])
	if a != b {
		t.Errorf("dos toques con la misma llave escribieron dos conversiones (%s y %s)", a, b)
	}
	m.exigirSaldo(t, "BTC", 2, "los dos toques descontaron")
	m.exigirSaldo(t, "ETH", 1, "los dos toques abonaron")
	if n := m.conversionesAnotadas(t); n != 1 {
		t.Fatalf("conversiones anotadas = %d, se esperaba 1", n)
	}
}

// ── Apartar para staking ────────────────────────────────────────────────────

func TestStaking_ElReintentoConLaMismaLlaveApartaUnaVez(t *testing.T) {
	m := montarVenta(t)
	m.sembrar(t, "ETH", "Ethereum", 3)

	primera := idCreado(t, m.apartarPorHTTP(apartarUnETH))
	segunda := idCreado(t, m.apartarPorHTTP(apartarUnETH))

	if segunda != primera {
		t.Errorf("el reintento abrio otra posicion (%s vs %s)", segunda, primera)
	}
	m.exigirSaldo(t, "ETH", 2, "el reintento volvio a apartar")
	if n := m.posicionesDeStaking(t); n != 1 {
		t.Fatalf("posiciones = %d, se esperaba 1", n)
	}
	if n := len(movimientosDeStaking(t, m)); n != 1 {
		t.Fatalf("movimientos de staking = %d, se esperaba 1", n)
	}
}

func TestStaking_LaMismaLlaveParaOtraPosicionSeRechaza(t *testing.T) {
	for _, c := range []struct{ nombre, cuerpo string }{
		{"otra cantidad",
			`{"asset":"ETH","amount":2,"locked":false,"idempotency_key":"crypto:stake:toque-1"}`},
		{"otro activo",
			`{"asset":"SOL","amount":1,"locked":false,"idempotency_key":"crypto:stake:toque-1"}`},
	} {
		t.Run(c.nombre, func(t *testing.T) {
			m := montarVenta(t)
			m.sembrar(t, "ETH", "Ethereum", 3)
			m.sembrar(t, "SOL", "Solana", 3)

			idCreado(t, m.apartarPorHTTP(apartarUnETH))
			exigirLlaveReutilizada(t, m.apartarPorHTTP(c.cuerpo))

			m.exigirSaldo(t, "ETH", 2, "solo debia quedar apartada la primera")
			m.exigirSaldo(t, "SOL", 3, "la segunda posicion no debia abrirse")
			if n := m.posicionesDeStaking(t); n != 1 {
				t.Fatalf("posiciones = %d, se esperaba 1", n)
			}
		})
	}
}

// El indice unico de la llave abarca todos los movimientos de cripto, no uno
// por tipo. Una llave que ya se gasto convirtiendo no puede abrir una posicion:
// si solo se comparara el activo y la cantidad, apartar 1 ETH con la llave de
// una conversion que dejo 1 ETH devolveria la conversion como si fuera la
// posicion.
func TestStaking_LaLlaveDeUnaConversionNoAparta(t *testing.T) {
	m := montarVenta(t)
	m.sembrar(t, "BTC", "Bitcoin", 1)

	idCreado(t, m.convertirPorHTTP(convertirUnBTC))
	exigirLlaveReutilizada(t, m.apartarPorHTTP(
		`{"asset":"ETH","amount":1,"locked":false,"idempotency_key":"crypto:convert:toque-1"}`))

	m.exigirSaldo(t, "ETH", 1, "la posicion no debia abrirse")
	if n := m.posicionesDeStaking(t); n != 0 {
		t.Fatalf("posiciones = %d, se esperaba 0", n)
	}
}

func TestStaking_ElReintentoConElSaldoAgotadoDevuelveLaPosicion(t *testing.T) {
	m := montarVenta(t)
	m.sembrar(t, "ETH", "Ethereum", 1)

	primera := idCreado(t, m.apartarPorHTTP(apartarUnETH))
	rec := m.apartarPorHTTP(apartarUnETH)
	if rec.Code != http.StatusCreated {
		t.Fatalf("el reintento de una posicion que ya se abrio = %d %s, se esperaba 201 con la misma posicion",
			rec.Code, rec.Body.String())
	}
	if segunda := idCreado(t, rec); segunda != primera {
		t.Errorf("el reintento devolvio otra posicion (%s vs %s)", segunda, primera)
	}
	m.exigirSaldo(t, "ETH", 0, "se aparto una sola vez todo el saldo")
	if n := m.posicionesDeStaking(t); n != 1 {
		t.Fatalf("posiciones = %d, se esperaba 1", n)
	}
}

func TestStaking_DosToquesSimultaneosApartanUnaVez(t *testing.T) {
	m := montarVenta(t)
	m.sembrar(t, "ETH", "Ethereum", 3)

	recs := aLaVez(2, func() *httptest.ResponseRecorder { return m.apartarPorHTTP(apartarUnETH) })

	a, b := idCreado(t, recs[0]), idCreado(t, recs[1])
	if a != b {
		t.Errorf("dos toques con la misma llave abrieron dos posiciones (%s y %s)", a, b)
	}
	m.exigirSaldo(t, "ETH", 2, "los dos toques apartaron")
	if n := m.posicionesDeStaking(t); n != 1 {
		t.Fatalf("posiciones = %d, se esperaba 1", n)
	}
}
