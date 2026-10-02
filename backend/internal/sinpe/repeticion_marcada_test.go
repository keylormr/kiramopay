package sinpe_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/kiramopay/backend/internal/contract"
	"github.com/kiramopay/backend/internal/middleware"
	"github.com/kiramopay/backend/internal/sinpe"
)

// Tras un corte de red la pantalla reintenta el SINPE con la misma llave, y si
// el primer intento ya habia salido el servidor contesta con aquel envio. Esa
// respuesta era igual a la de un envio nuevo, asi que a quien repetia a
// proposito un envio identico —el mismo monto al mismo numero, con la llave que
// la pantalla conserva mientras no sabe que paso— le decia "Enviado" por un
// envio que el servidor no hizo. Ahora la repeticion lo dice con
// `replayed: true`, y solo ella, como en cripto.

const urlEnviarSinpe = "http://localhost:8080/api/v1/sinpe/send"

// envioLeido es lo que la pantalla lee de un envio que salio bien: el id y la
// marca. Guarda tambien el data entero, para validarlo contra el contrato.
type envioLeido struct {
	id string
	// marcado: trae "replayed": true.
	marcado bool
	// conClave: trae la clave "replayed", valga lo que valga. Un envio nuevo no
	// la trae.
	conClave bool
	data     any
}

func enviarPorElHandler(t *testing.T, h *sinpe.Handler, userID, cuerpo string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/sinpe/send", strings.NewReader(cuerpo))
	req = req.WithContext(context.WithValue(req.Context(), middleware.UserIDKey, userID))
	rec := httptest.NewRecorder()
	h.Send(rec, req)
	return rec
}

// leerEnvio exige el 200 y lee el id y la marca de la respuesta.
func leerEnvio(t *testing.T, rec *httptest.ResponseRecorder) envioLeido {
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
	var e envioLeido
	if err := json.Unmarshal(campos["transaction_id"], &e.id); err != nil || e.id == "" {
		t.Fatalf("la respuesta no trae transaction_id: %s", rec.Body.String())
	}
	if crudo, ok := campos["replayed"]; ok {
		e.conClave = true
		e.marcado = string(crudo) == "true"
	}
	if err := json.Unmarshal(sobre.Data, &e.data); err != nil {
		t.Fatalf("decodificar data: %v", err)
	}
	return e
}

// marcadoComoRepeticion dice si lo que devolvio el servicio sale al cliente con
// la marca: es lo mismo que el handler escribe en la respuesta.
func marcadoComoRepeticion(t *testing.T, v any) bool {
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

// envioCumpleElContrato valida cada respuesta contra el esquema publicado y
// exige que el esquema documente la marca: un campo que el contrato no menciona
// pasaria la validacion igual.
func envioCumpleElContrato(t *testing.T, envios ...envioLeido) {
	t.Helper()
	doc, err := contract.LoadSpec("../../docs/openapi.yaml")
	if err != nil {
		t.Fatalf("cargar el contrato: %v", err)
	}
	router, err := contract.NewRouter(doc)
	if err != nil {
		t.Fatalf("router del contrato: %v", err)
	}
	for _, e := range envios {
		if err := contract.ValidateData(router, http.MethodPost, urlEnviarSinpe, http.StatusOK, e.data); err != nil {
			t.Errorf("la respuesta no cumple SinpeSendResponse: %v", err)
		}
	}
	s := doc.Components.Schemas["SinpeSendResponse"]
	if s == nil || s.Value == nil {
		t.Fatalf("el contrato no tiene SinpeSendResponse")
	}
	marca := s.Value.Properties["replayed"]
	if marca == nil || marca.Value == nil || !marca.Value.Type.Is("boolean") {
		t.Errorf("SinpeSendResponse no documenta replayed como booleano")
	}
}

func TestHandlerSend_LaRepeticionLoDiceYElEnvioNuevoNo(t *testing.T) {
	svc, emisor, _, _ := sinpeConAvisos(t, nil)
	h := sinpe.NewHandler(svc)
	cuerpo := `{"phone":"+50688885678","amount":1000000,"idempotency_key":"sinpe:marca"}`

	nuevo := leerEnvio(t, enviarPorElHandler(t, h, emisor, cuerpo))
	repetido := leerEnvio(t, enviarPorElHandler(t, h, emisor, cuerpo))

	if nuevo.conClave {
		t.Errorf("el envio nuevo trae la clave replayed: %v", nuevo.data)
	}
	if !repetido.marcado {
		t.Errorf("la repeticion no trae replayed: true: %v", repetido.data)
	}
	if repetido.id != nuevo.id {
		t.Errorf("la repeticion devolvio %s, el envio fue %s", repetido.id, nuevo.id)
	}
	envioCumpleElContrato(t, nuevo, repetido)
}

// cerrarCuenta da de baja a la persona: FindByPhone ya no la encuentra.
func cerrarCuenta(t *testing.T, pool *pgxpool.Pool, userID string) {
	t.Helper()
	if _, err := pool.Exec(context.Background(),
		`UPDATE users SET deleted_at = NOW() WHERE id = $1::uuid`, userID); err != nil {
		t.Fatalf("cerrar la cuenta: %v", err)
	}
}

// El envio salio y, antes de que llegara el reintento, la cuenta de quien lo
// recibio se cerro. El reintento volvia a buscar a quien recibe por el
// telefono, no lo encontraba y contestaba RECIPIENT_NOT_USER por un envio que
// si habia salido: la pantalla lo daba por fallido.
func TestSend_LaRepeticionContestaAunqueLaCuentaDeQuienRecibioSeHayaCerrado(t *testing.T) {
	svc, emisor, receptor, pool := sinpeConAvisos(t, nil)
	const llave = "sinpe:cuenta-cerrada"

	primero, err := enviarSinpe(svc, emisor, montoSinpe, llave)
	if err != nil {
		t.Fatalf("el envio: %v", err)
	}
	cerrarCuenta(t, pool, receptor)

	segundo, err := enviarSinpe(svc, emisor, montoSinpe, llave)
	if err != nil {
		t.Fatalf("el reintento de un envio que ya salio fallo: %v", err)
	}
	if segundo.TransactionID != primero.TransactionID {
		t.Errorf("el reintento devolvio %s, el envio fue %s", segundo.TransactionID, primero.TransactionID)
	}
	if !marcadoComoRepeticion(t, segundo) {
		t.Errorf("el reintento no dice que el envio ya estaba hecho")
	}
}

// La guarda: sin un envio previo con esa llave, a una cuenta cerrada no se le
// envia nada.
func TestSend_AUnaCuentaCerradaNoSeLeEnviaSinUnEnvioPrevio(t *testing.T) {
	svc, emisor, receptor, pool := sinpeConAvisos(t, nil)
	cerrarCuenta(t, pool, receptor)

	if _, err := enviarSinpe(svc, emisor, montoSinpe, "sinpe:cuenta-cerrada:nueva"); !errors.Is(err, sinpe.ErrRecipientNotUser) {
		t.Fatalf("enviar a una cuenta cerrada: err = %v, se esperaba ErrRecipientNotUser", err)
	}
}

// Y la llave de un envio hecho con OTRO monto tampoco contesta por la cuenta
// cerrada: no es el reintento de aquel envio.
func TestSend_LaLlaveDeOtroMontoNoContestaPorUnaCuentaCerrada(t *testing.T) {
	svc, emisor, receptor, pool := sinpeConAvisos(t, nil)
	const llave = "sinpe:cuenta-cerrada:otro-monto"

	if _, err := enviarSinpe(svc, emisor, montoSinpe, llave); err != nil {
		t.Fatalf("el envio: %v", err)
	}
	cerrarCuenta(t, pool, receptor)

	if _, err := enviarSinpe(svc, emisor, 2*montoSinpe, llave); !errors.Is(err, sinpe.ErrRecipientNotUser) {
		t.Fatalf("la llave de otro monto hacia una cuenta cerrada: err = %v, se esperaba ErrRecipientNotUser", err)
	}
}

// Ni la llave de un envio hecho, con el MISMO monto, hacia otro numero que no
// es de KiramoPay: la repeticion se reconocia sin mirar a quien iba, y el
// servidor contestaba que aquel envio ya estaba hecho —con el nombre de quien
// lo recibio— por un pedido a otra persona. La pantalla no lo provoca, porque
// su llave cambia con el numero; un cliente que reutilice llaves si.
func TestSend_LaLlaveDeUnEnvioHechoNoContestaPorOtroNumero(t *testing.T) {
	svc, emisor, _, _ := sinpeConAvisos(t, nil)
	const llave = "sinpe:otro-numero"

	if _, err := enviarSinpe(svc, emisor, montoSinpe, llave); err != nil {
		t.Fatalf("el envio: %v", err)
	}

	_, err := svc.Send(context.Background(), emisor, &sinpe.SendRequest{
		Phone: telefonoSinCuenta, Amount: montoSinpe, IdempotencyKey: llave,
	}, "")
	if !errors.Is(err, sinpe.ErrRecipientNotUser) {
		t.Fatalf("la llave de un envio hecho, hacia otro numero: err = %v, se esperaba ErrRecipientNotUser", err)
	}
}

// alargarNombre deja a la persona con nombre y apellido de 80 caracteres cada
// uno: juntos, 161.
func alargarNombre(t *testing.T, pool *pgxpool.Pool, userID, letra string) {
	t.Helper()
	if _, err := pool.Exec(context.Background(),
		`UPDATE users SET first_name = repeat($2, 80), last_name = repeat($2, 80) WHERE id = $1::uuid`,
		userID, letra); err != nil {
		t.Fatalf("alargar el nombre: %v", err)
	}
}

// Nombre y apellido pueden sumar 201 caracteres, y el historial SINPE guarda el
// nombre en un VARCHAR(100). Desde que el historial se escribe dentro de la
// transaccion del dinero, un nombre largo hacia fallar el envio entero, y
// siempre igual: ni reintentar ni cambiar la llave lo arreglaba.
func TestSend_ConNombresLargosElEnvioSale(t *testing.T) {
	svc, emisor, receptor, pool := sinpeConAvisos(t, nil)
	alargarNombre(t, pool, emisor, "a")
	// Con enes: la columna cuenta caracteres, no bytes, y un corte por bytes
	// partiria una letra en dos.
	alargarNombre(t, pool, receptor, "ñ")

	if _, err := enviarSinpe(svc, emisor, montoSinpe, "sinpe:nombre-largo"); err != nil {
		t.Fatalf("un nombre largo hizo fallar el envio: %v", err)
	}
	for _, fila := range []struct{ userID, tipo string }{{emisor, "sent"}, {receptor, "received"}} {
		var nombre string
		if err := pool.QueryRow(context.Background(),
			`SELECT contact_name FROM sinpe_history WHERE user_id = $1::uuid AND type = $2`,
			fila.userID, fila.tipo).Scan(&nombre); err != nil {
			t.Fatalf("leer el historial %s: %v", fila.tipo, err)
		}
		if nombre == "" || utf8.RuneCountInString(nombre) > 100 || !utf8.ValidString(nombre) {
			t.Errorf("el historial %s guardo %q", fila.tipo, nombre)
		}
	}
}
