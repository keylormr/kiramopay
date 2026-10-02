package crypto_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/kiramopay/backend/internal/contract"
	"github.com/kiramopay/backend/internal/crypto"
	"github.com/kiramopay/backend/internal/middleware"
)

// Tras un corte de red la pantalla reintenta con la misma llave, y si el primer
// intento ya se habia hecho el servidor contesta con aquel. Esa respuesta era
// igual a la de una operacion nueva, asi que la pantalla la anotaba otra vez —la
// fila doble y el saldo contado dos veces hasta la siguiente carga— y a quien
// repetia a proposito una operacion identica le decia "listo" por una que el
// servidor no hizo. Ahora la respuesta repetida lo dice con `replayed: true`, y
// solo ella: la de una operacion nueva no trae la clave.
//
// Las pruebas van por el handler, como la pantalla. El feed cotiza todo a 1000
// dolares y el tipo de cambio es 500.

const (
	urlComprar = "http://localhost:8080/api/v1/crypto/buy"
	urlEnviar  = "http://localhost:8080/api/v1/crypto/send"
)

// respuestaDeOperacion es lo que la pantalla lee de una operacion que salio
// bien: el id y la marca. Guarda tambien el data entero, para validarlo contra
// el contrato.
type respuestaDeOperacion struct {
	id string
	// marcada: trae "replayed": true.
	marcada bool
	// conClave: trae la clave "replayed", valga lo que valga. Una operacion
	// nueva no la trae.
	conClave bool
	data     any
}

// leerOperacion exige el 201 y lee el id y la marca de la respuesta.
func leerOperacion(t *testing.T, rec *httptest.ResponseRecorder) respuestaDeOperacion {
	t.Helper()
	if rec.Code != http.StatusCreated {
		t.Fatalf("respuesta = %d, se esperaba 201: %s", rec.Code, rec.Body.String())
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
	var r respuestaDeOperacion
	if err := json.Unmarshal(campos["id"], &r.id); err != nil || r.id == "" {
		t.Fatalf("la respuesta no trae id: %s", rec.Body.String())
	}
	if crudo, ok := campos["replayed"]; ok {
		r.conClave = true
		r.marcada = string(crudo) == "true"
	}
	if err := json.Unmarshal(sobre.Data, &r.data); err != nil {
		t.Fatalf("decodificar data: %v", err)
	}
	return r
}

// marcadaComoRepeticion dice si lo que devolvio el servicio sale al cliente
// con la marca: es lo mismo que el handler escribe en la respuesta.
func marcadaComoRepeticion(t *testing.T, v any) bool {
	t.Helper()
	crudo, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("serializar la respuesta: %v", err)
	}
	var campos map[string]json.RawMessage
	if err := json.Unmarshal(crudo, &campos); err != nil {
		t.Fatalf("leer la respuesta serializada: %v", err)
	}
	return string(campos["replayed"]) == "true"
}

// exigirNuevaYRepetida: la primera respuesta es una operacion nueva y no trae
// la clave; la segunda es la repeticion, trae la marca y el mismo id.
func exigirNuevaYRepetida(t *testing.T, nueva, repetida respuestaDeOperacion) {
	t.Helper()
	if nueva.conClave {
		t.Errorf("la operacion nueva trae la clave replayed: %v", nueva.data)
	}
	if !repetida.marcada {
		t.Errorf("la repeticion no trae replayed: true: %v", repetida.data)
	}
	if repetida.id != nueva.id {
		t.Errorf("la repeticion devolvio %s, la operacion fue %s", repetida.id, nueva.id)
	}
}

// exigirUnaSolaNueva: de varias respuestas a la misma llave, todas hablan de la
// misma operacion y una sola dice ser nueva.
func exigirUnaSolaNueva(t *testing.T, recs []*httptest.ResponseRecorder) {
	t.Helper()
	nuevas := 0
	var id string
	for i, rec := range recs {
		r := leerOperacion(t, rec)
		if i == 0 {
			id = r.id
		} else if r.id != id {
			t.Fatalf("una respuesta habla de %s y otra de %s: se hizo dos veces", id, r.id)
		}
		if r.conClave && !r.marcada {
			t.Errorf("una respuesta trae replayed sin ser true: %v", r.data)
		}
		if !r.marcada {
			nuevas++
		}
	}
	if nuevas != 1 {
		t.Fatalf("%d de %d respuestas dicen ser una operacion nueva, se esperaba 1", nuevas, len(recs))
	}
}

// cumpleElContrato valida cada respuesta contra el esquema publicado y exige
// que el esquema documente la marca: sin additionalProperties: false, un campo
// que el contrato no menciona pasaria la validacion igual.
func cumpleElContrato(t *testing.T, url, esquema string, respuestas ...respuestaDeOperacion) {
	t.Helper()
	doc, err := contract.LoadSpec("../../docs/openapi.yaml")
	if err != nil {
		t.Fatalf("cargar el contrato: %v", err)
	}
	router, err := contract.NewRouter(doc)
	if err != nil {
		t.Fatalf("router del contrato: %v", err)
	}
	for _, r := range respuestas {
		if err := contract.ValidateData(router, http.MethodPost, url, http.StatusCreated, r.data); err != nil {
			t.Errorf("la respuesta no cumple %s: %v", esquema, err)
		}
	}
	s := doc.Components.Schemas[esquema]
	if s == nil || s.Value == nil {
		t.Fatalf("el contrato no tiene %s", esquema)
	}
	marca := s.Value.Properties["replayed"]
	if marca == nil || marca.Value == nil || !marca.Value.Type.Is("boolean") {
		t.Errorf("%s no documenta replayed como booleano", esquema)
	}
}

// operacionConLlave es una de las cuatro operaciones que caben en
// montarVenta. El envio necesita a otra persona y va aparte.
type operacionConLlave struct {
	nombre  string
	url     string
	esquema string
	sembrar func(t *testing.T, m *montajeVenta)
	atender func(m *montajeVenta) http.HandlerFunc
	cuerpo  string
}

func operacionesConLlave() []operacionConLlave {
	return []operacionConLlave{
		{
			nombre: "comprar", url: urlComprar, esquema: "CryptoTransactionRecord",
			sembrar: func(*testing.T, *montajeVenta) {},
			atender: func(m *montajeVenta) http.HandlerFunc { return m.h.Buy },
			// 50.000 colones a 500.000 la unidad: 0,1 BTC.
			cuerpo: `{"asset":"BTC","from_currency":"CRC","from_amount":50000,"price":1000,"idempotency_key":"crypto:buy:toque-1"}`,
		},
		{
			nombre: "vender", url: urlVender, esquema: "CryptoTransactionRecord",
			sembrar: func(t *testing.T, m *montajeVenta) { m.sembrar(t, "ETH", "Ethereum", 3) },
			atender: func(m *montajeVenta) http.HandlerFunc { return m.h.Sell },
			cuerpo:  `{"asset":"ETH","amount":0.1,"price":1000,"to_currency":"CRC","idempotency_key":"crypto:sell:toque-1"}`,
		},
		{
			nombre: "convertir", url: urlConvertir, esquema: "CryptoTransactionRecord",
			sembrar: func(t *testing.T, m *montajeVenta) { m.sembrar(t, "BTC", "Bitcoin", 3) },
			atender: func(m *montajeVenta) http.HandlerFunc { return m.h.Convert },
			cuerpo:  convertirUnBTC,
		},
		{
			nombre: "apartar", url: urlApartar, esquema: "StakingPositionRecord",
			sembrar: func(t *testing.T, m *montajeVenta) { m.sembrar(t, "ETH", "Ethereum", 3) },
			atender: func(m *montajeVenta) http.HandlerFunc { return m.h.Stake },
			cuerpo:  apartarUnETH,
		},
	}
}

// Una por una: la primera respuesta es una operacion nueva y no trae la marca;
// la segunda, con la misma llave, es la repeticion. Comprar y vender la
// contestan antes de pedir el precio; convertir y apartar, en la relectura de
// la llave. Las dos respuestas cumplen el contrato.
func TestRepeticion_LaRespuestaRepetidaLoDiceYLaNuevaNo(t *testing.T) {
	for _, op := range operacionesConLlave() {
		t.Run(op.nombre, func(t *testing.T) {
			m := montarVenta(t)
			op.sembrar(t, m)
			nueva := leerOperacion(t, m.porHTTP(op.url, op.atender(m), op.cuerpo))
			repetida := leerOperacion(t, m.porHTTP(op.url, op.atender(m), op.cuerpo))
			exigirNuevaYRepetida(t, nueva, repetida)
			cumpleElContrato(t, op.url, op.esquema, nueva, repetida)
		})
	}
}

// Varios toques a la vez con la misma llave. Uno solo hace la operacion y es
// el unico sin la marca. Los demas llegan por los caminos de la carrera —la
// fila o el asiento que otro ya escribio, en comprar y vender; la llave que
// otro ya anoto, en convertir y apartar— y tambien tienen que decirlo.
func TestRepeticion_DeVariosToquesSimultaneosUnoSoloEsNuevo(t *testing.T) {
	for _, op := range operacionesConLlave() {
		t.Run(op.nombre, func(t *testing.T) {
			m := montarVenta(t)
			op.sembrar(t, m)
			exigirUnaSolaNueva(t, aLaVez(3, func() *httptest.ResponseRecorder {
				return m.porHTTP(op.url, op.atender(m), op.cuerpo)
			}))
		})
	}
}

// La compra cuya fila del libro quedo sin marcar aunque su asiento confirmo.
// La relectura de antes del precio solo contesta una compra completada, asi
// que esta repeticion llega hasta el libro, que repara la fila: el dinero se
// movio la primera vez y esta llamada no movio nada. Tambien es repeticion.
func TestRepeticion_LaCompraQueSeReparaTambienLoDice(t *testing.T) {
	m := montarVenta(t)
	op := operacionesConLlave()[0]
	nueva := leerOperacion(t, m.porHTTP(op.url, op.atender(m), op.cuerpo))
	if _, err := m.pool.Exec(context.Background(),
		`UPDATE transactions SET status = 'pending' WHERE id = $1::uuid`, nueva.id); err != nil {
		t.Fatalf("dejar la fila sin marcar: %v", err)
	}
	crc, _ := m.billetera(t)

	repetida := leerOperacion(t, m.porHTTP(op.url, op.atender(m), op.cuerpo))
	exigirNuevaYRepetida(t, nueva, repetida)
	if got, _ := m.billetera(t); got != crc {
		t.Fatalf("billetera CRC = %d, se esperaba %d: la reparacion cobro otra vez", got, crc)
	}
}

func (e *entornoDeEnvio) enviarPorHTTP(t *testing.T, llave string) *httptest.ResponseRecorder {
	cuerpo, err := json.Marshal(map[string]any{
		"asset": "BTC", "amount": seEnvia, "qr_data": e.qrDelReceptor, "price": 1000,
		"idempotency_key": llave,
	})
	if err != nil {
		t.Errorf("armar el cuerpo del envio: %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, urlEnviar, bytes.NewReader(cuerpo))
	req = req.WithContext(context.WithValue(req.Context(), middleware.UserIDKey, e.quienEnvia))
	rec := httptest.NewRecorder()
	crypto.NewHandler(e.svc).Send(rec, req)
	return rec
}

// El envio, igual: el repetido lo dice, el nuevo no, y los dos cumplen el
// contrato.
func TestRepeticion_ElEnvioRepetidoLoDiceYElNuevoNo(t *testing.T) {
	e := montarEnvio(t)
	nuevo := leerOperacion(t, e.enviarPorHTTP(t, "crypto:send:toque-1"))
	repetido := leerOperacion(t, e.enviarPorHTTP(t, "crypto:send:toque-1"))
	exigirNuevaYRepetida(t, nuevo, repetido)
	cumpleElContrato(t, urlEnviar, "CryptoTransactionRecord", nuevo, repetido)
}

func TestRepeticion_DeVariosEnviosSimultaneosUnoSoloEsNuevo(t *testing.T) {
	e := montarEnvio(t)
	exigirUnaSolaNueva(t, aLaVez(3, func() *httptest.ResponseRecorder {
		return e.enviarPorHTTP(t, "crypto:send:toque-1")
	}))
}
