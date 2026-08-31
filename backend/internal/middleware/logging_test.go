package middleware

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gorilla/websocket"
)

// El upgrade de WebSocket necesita que el writer que llega al handler exponga
// http.Hijacker. statusWriter envuelve al writer real y el embedding solo
// reexpone los metodos de la interfaz http.ResponseWriter, asi que sin el
// forward explicito TODOS los /ws respondian 500 en produccion. Esta prueba
// hace el handshake completo a traves del middleware: antes del arreglo
// fallaba, con el arreglo abre y entrega un mensaje.
func TestLogger_PermiteUpgradeDeWebSocket(t *testing.T) {
	upgrader := websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}

	h := Logger(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			t.Errorf("Upgrade() a traves del Logger: %v", err)
			return
		}
		defer conn.Close()
		if err := conn.WriteMessage(websocket.TextMessage, []byte("hola")); err != nil {
			t.Errorf("WriteMessage: %v", err)
		}
	}))

	srv := httptest.NewServer(h)
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http")
	conn, resp, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		status := "sin respuesta"
		if resp != nil {
			status = resp.Status
		}
		t.Fatalf("handshake fallo: %v (respuesta %s)", err, status)
	}
	defer conn.Close()

	_, msg, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("ReadMessage: %v", err)
	}
	if string(msg) != "hola" {
		t.Fatalf("mensaje = %q, se esperaba %q", msg, "hola")
	}
}

// Cuando el writer de abajo NO implementa Hijacker (como el ResponseRecorder
// de las pruebas), Hijack debe devolver un error claro en vez de entrar en
// panico.
func TestStatusWriter_HijackSinSoporteDevuelveError(t *testing.T) {
	sw := &statusWriter{ResponseWriter: httptest.NewRecorder()}
	if _, _, err := sw.Hijack(); err == nil {
		t.Fatal("Hijack() sobre un writer sin Hijacker: se esperaba error, llego nil")
	}
}
