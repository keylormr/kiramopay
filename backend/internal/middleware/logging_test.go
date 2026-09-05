package middleware

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
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

// pedir hace un GET y descarta el cuerpo; lo que interesa es el rastro que la
// peticion deja en las metricas.
func pedir(t *testing.T, url string) {
	t.Helper()
	resp, err := http.Get(url)
	if err != nil {
		t.Fatalf("GET %s: %v", url, err)
	}
	_, _ = io.Copy(io.Discard, resp.Body)
	resp.Body.Close()
}

// Las metricas se indexaban por r.URL.Path CRUDO en mapas que nunca desalojan
// nada, y este middleware corre por encima del limitador: cualquiera podia
// hacerlos crecer sin techo pidiendo rutas inventadas (y hasta las peticiones
// rechazadas dejaban su clave). La clave debe ser el PATRON de la ruta, y una
// ruta que chi no reconoce no debe dejar ninguna.
func TestLogger_MetricasPorPatronDeRutaNoPorURLCruda(t *testing.T) {
	r := chi.NewRouter()
	r.Use(Logger)
	r.Get("/prueba-metricas/{nombre}", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	srv := httptest.NewServer(r)
	defer srv.Close()

	pedir(t, srv.URL+"/prueba-metricas/keilor")
	pedir(t, srv.URL+"/prueba-metricas/victor")
	pedir(t, srv.URL+"/basura-inventada-por-un-atacante")

	cuerpo := scrapeMetrics(t)
	if !strings.Contains(cuerpo, `path="/prueba-metricas/{nombre}"`) {
		t.Fatalf("no se registro la ruta por su patron:\n%s", cuerpo)
	}
	for _, valor := range []string{"keilor", "victor"} {
		if strings.Contains(cuerpo, valor) {
			t.Fatalf("el valor %q de la URL creo su propia clave: el mapa crece con cada peticion distinta:\n%s", valor, cuerpo)
		}
	}
	if strings.Contains(cuerpo, "basura-inventada-por-un-atacante") {
		t.Fatalf("una ruta que no existe dejo clave en las metricas:\n%s", cuerpo)
	}
}
