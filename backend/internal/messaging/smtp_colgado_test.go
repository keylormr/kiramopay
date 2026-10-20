package messaging

import (
	"context"
	"net"
	"strconv"
	"sync"
	"testing"
	"time"
)

// servidorMudo acepta conexiones TCP y nunca manda el saludo 220: un relevo SMTP
// colgado. Cierra lo que acepto al terminar la prueba.
func servidorMudo(t *testing.T) (host string, port int) {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	var (
		mu    sync.Mutex
		conns []net.Conn
	)
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			mu.Lock()
			conns = append(conns, c)
			mu.Unlock()
		}
	}()
	t.Cleanup(func() {
		_ = ln.Close()
		mu.Lock()
		defer mu.Unlock()
		for _, c := range conns {
			_ = c.Close()
		}
	})
	h, p, _ := net.SplitHostPort(ln.Addr().String())
	n, _ := strconv.Atoi(p)
	return h, n
}

// Un servidor que acepta la conexion y no contesta no puede colgar a quien
// manda: el envio termina cuando vence o se cancela su contexto. Sin esto, la
// bandeja de respuestas escritas, que manda dentro del lock del barrido, deja
// detenidos el cierre del dia 30 y la desasociacion hasta reiniciar el proceso.
func TestSendEmail_UnServidorQueNoContestaNoLoCuelga(t *testing.T) {
	casos := []struct {
		nombre   string
		contexto func() (context.Context, context.CancelFunc)
	}{
		{"vence el plazo del contexto", func() (context.Context, context.CancelFunc) {
			return context.WithTimeout(context.Background(), 300*time.Millisecond)
		}},
		{"cancelan el contexto", func() (context.Context, context.CancelFunc) {
			ctx, cancel := context.WithCancel(context.Background())
			time.AfterFunc(300*time.Millisecond, cancel)
			return ctx, cancel
		}},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			host, port := servidorMudo(t)
			e := newSMTPEmail(EmailConfig{SMTPHost: host, SMTPPort: port, From: "no-reply@kiramopay.com"})
			ctx, cancel := c.contexto()
			defer cancel()

			hecho := make(chan error, 1)
			go func() { hecho <- e.SendEmail(ctx, "persona@ejemplo.test", "Asunto", "Texto", "") }()
			select {
			case err := <-hecho:
				if err == nil {
					t.Fatal("un servidor que no contesta no puede dar el envio por bueno")
				}
			case <-time.After(5 * time.Second):
				t.Fatal("SendEmail sigue colgado 5 s despues de vencer su contexto")
			}
		})
	}
}
