package messaging

import (
	"bufio"
	"context"
	"net"
	"strconv"
	"strings"
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

// servidorQueNoDespide habla SMTP, acepta el mensaje (250 al terminar DATA) y
// despues no contesta el QUIT. aceptado se cierra cuando el mensaje quedo en
// cola.
func servidorQueNoDespide(t *testing.T) (host string, port int, aceptado chan struct{}) {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	aceptado = make(chan struct{})
	var (
		mu    sync.Mutex
		conns []net.Conn
	)
	go func() {
		c, err := ln.Accept()
		if err != nil {
			return
		}
		mu.Lock()
		conns = append(conns, c)
		mu.Unlock()
		r := bufio.NewReader(c)
		decir := func(s string) { _, _ = c.Write([]byte(s + "\r\n")) }
		decir("220 relevo.ejemplo.test ESMTP")
		for {
			linea, err := r.ReadString('\n')
			if err != nil {
				return
			}
			orden := strings.ToUpper(strings.TrimSpace(linea))
			switch {
			case strings.HasPrefix(orden, "EHLO"), strings.HasPrefix(orden, "HELO"):
				decir("250-relevo.ejemplo.test")
				decir("250 AUTH PLAIN")
			case strings.HasPrefix(orden, "AUTH"):
				decir("235 2.7.0 ok")
			case strings.HasPrefix(orden, "MAIL"), strings.HasPrefix(orden, "RCPT"):
				decir("250 2.1.0 ok")
			case orden == "DATA":
				decir("354 adelante")
				for {
					l, err := r.ReadString('\n')
					if err != nil {
						return
					}
					if l == ".\r\n" {
						break
					}
				}
				decir("250 2.0.0 queued")
				close(aceptado)
			case orden == "QUIT":
				// No contesta: el relevo se atasco despues de aceptar.
			}
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
	return h, n, aceptado
}

// Un mensaje que el relevo ya acepto quedo enviado aunque el QUIT no llegue a
// contestarse: reportarlo como fallo hace que la bandeja lo vuelva a mandar y la
// persona reciba la respuesta dos veces.
func TestSendEmail_UnQUITSinRespuestaNoDeshaceUnEnvioAceptado(t *testing.T) {
	host, port, aceptado := servidorQueNoDespide(t)
	e := newSMTPEmail(EmailConfig{SMTPHost: host, SMTPPort: port, SMTPUser: "u", SMTPPassword: "p", From: "no-reply@kiramopay.com"})
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	hecho := make(chan error, 1)
	go func() { hecho <- e.SendEmail(ctx, "persona@ejemplo.test", "Asunto", "Texto", "") }()
	select {
	case err := <-hecho:
		select {
		case <-aceptado:
		default:
			t.Fatalf("el relevo nunca acepto el mensaje: %v", err)
		}
		if err != nil {
			t.Errorf("el mensaje ya estaba aceptado y se reporto como fallo: %v", err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("SendEmail sigue colgado 10 s despues de vencer su contexto")
	}
}

// Y no se queda esperando el QUIT hasta que venza el plazo de toda la
// conversacion: con el mensaje aceptado, el barrido sigue con la siguiente.
func TestSendEmail_UnQUITSinRespuestaNoRetieneElEnvio(t *testing.T) {
	host, port, _ := servidorQueNoDespide(t)
	e := newSMTPEmail(EmailConfig{SMTPHost: host, SMTPPort: port, SMTPUser: "u", SMTPPassword: "p", From: "no-reply@kiramopay.com"})
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	hecho := make(chan error, 1)
	go func() { hecho <- e.SendEmail(ctx, "persona@ejemplo.test", "Asunto", "Texto", "") }()
	select {
	case err := <-hecho:
		if err != nil {
			t.Errorf("el mensaje ya estaba aceptado: %v", err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("SendEmail espera el QUIT hasta el plazo de 30 s")
	}
}
