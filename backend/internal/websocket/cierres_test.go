package websocket

import (
	"bytes"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

// bufferSeguro recoge lo que escribe el logger: la lectura del socket y el hub
// escriben desde goroutines distintas a la de la prueba.
type bufferSeguro struct {
	mu sync.Mutex
	b  bytes.Buffer
}

func (s *bufferSeguro) Write(p []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.b.Write(p)
}

func (s *bufferSeguro) lineas() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return strings.Split(strings.TrimSpace(s.b.String()), "\n")
}

// esperarDesconexion espera a que el hub registre la baja del cliente. Se
// escribe DESPUES de que readPump termino, asi que lo que el read loop tuviera
// que decir sobre el cierre ya esta en el registro.
func (s *bufferSeguro) esperarDesconexion(t *testing.T) {
	t.Helper()
	limite := time.Now().Add(3 * time.Second)
	for time.Now().Before(limite) {
		for _, l := range s.lineas() {
			if strings.Contains(l, "WebSocket client disconnected") {
				return
			}
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("el hub nunca dio de baja al cliente; registro:\n%s", strings.Join(s.lineas(), "\n"))
}

// lineaCon devuelve la primera linea que contenga TODAS las partes.
func (s *bufferSeguro) lineaCon(partes ...string) (string, bool) {
	for _, l := range s.lineas() {
		ok := true
		for _, p := range partes {
			if !strings.Contains(l, p) {
				ok = false
				break
			}
		}
		if ok {
			return l, true
		}
	}
	return "", false
}

// servidorPublico levanta el canal publico de precios con un logger que recoge
// todo, DEBUG incluido.
func servidorPublico(t *testing.T) (*httptest.Server, *bufferSeguro) {
	t.Helper()
	buf := &bufferSeguro{}
	logger := slog.New(slog.NewTextHandler(buf, &slog.HandlerOptions{Level: slog.LevelDebug}))
	hub := NewHub(logger)
	go hub.Run()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ServeWs(hub, logger, w, r)
	}))
	t.Cleanup(srv.Close)
	return srv, buf
}

// Un cierre normal o abrupto del cliente no es una falla del servidor. El
// registro marcaba ERROR cada vez que un telefono perdia la senal (1006: se
// cae el TCP sin cerrar el socket), y en el panel de logs esas lineas tapaban
// los errores de verdad.
//
//   - 1000 y 1001: el cliente se despide (cierra la pestana, cambia de pantalla).
//     Es la vida normal de un socket: INFO.
//   - 1006: la conexion murio sin despedida. Pasa todo el dia con clientes
//     moviles, pero conviene que se vea: WARN.
func TestLecturaDelSocket_ElNivelDelRegistroSigueAlTipoDeCierre(t *testing.T) {
	casos := []struct {
		nombre string
		cerrar func(conn *websocket.Conn)
		nivel  string
		codigo string
	}{
		{
			nombre: "cierre normal",
			cerrar: func(conn *websocket.Conn) {
				_ = conn.WriteMessage(websocket.CloseMessage,
					websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""))
			},
			nivel: "level=INFO", codigo: "code=1000",
		},
		{
			nombre: "going away",
			cerrar: func(conn *websocket.Conn) {
				_ = conn.WriteMessage(websocket.CloseMessage,
					websocket.FormatCloseMessage(websocket.CloseGoingAway, ""))
			},
			nivel: "level=INFO", codigo: "code=1001",
		},
		{
			nombre: "cierre abrupto sin despedida",
			cerrar: func(conn *websocket.Conn) {
				_ = conn.UnderlyingConn().Close()
			},
			nivel: "level=WARN", codigo: "code=1006",
		},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			srv, buf := servidorPublico(t)
			conn := dialWS(t, srv)

			c.cerrar(conn)
			_ = conn.Close()
			buf.esperarDesconexion(t)

			if l, hay := buf.lineaCon("level=ERROR"); hay {
				t.Errorf("un cierre del cliente no es un ERROR del servidor: %s", l)
			}
			if l, hay := buf.lineaCon(c.nivel, c.codigo); !hay {
				t.Errorf("falta la linea %s con %s; registro:\n%s", c.nivel, c.codigo, strings.Join(buf.lineas(), "\n"))
			} else {
				t.Logf("registro: %s", l)
			}
		})
	}
}
