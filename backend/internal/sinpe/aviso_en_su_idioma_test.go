package sinpe_test

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/kiramopay/backend/internal/notification"
	"github.com/kiramopay/backend/internal/testutil"
)

// De punta a punta: quien recibe un SINPE y usa la app en ingles recibe el
// aviso en ingles. Antes el titulo y el cuerpo estaban fijos en espanol en
// este paquete.
func TestSend_QuienRecibeEnInglesRecibeElAvisoEnIngles(t *testing.T) {
	// El servicio de avisos va con su propio pool sobre la misma base:
	// sinpeConAvisos arma el suyo.
	avisos := notification.NewService(notification.NewRepository(testutil.TestDB(t)), "", "")
	svc, emisor, receptor, pool := sinpeConAvisos(t, avisos)
	if _, err := pool.Exec(context.Background(),
		`UPDATE users SET language = 'en' WHERE id = $1::uuid`, receptor); err != nil {
		t.Fatalf("guardar el idioma de quien recibe: %v", err)
	}

	if _, err := enviarSinpe(svc, emisor, montoSinpe, "sinpe:aviso:idioma"); err != nil {
		t.Fatalf("el envio: %v", err)
	}

	// El aviso sale en segundo plano, despues de responder.
	var titulo, cuerpo string
	limite := time.Now().Add(5 * time.Second)
	for {
		err := pool.QueryRow(context.Background(),
			`SELECT title, body FROM notification_history WHERE user_id = $1::uuid
			  ORDER BY created_at DESC LIMIT 1`, receptor).Scan(&titulo, &cuerpo)
		if err == nil {
			break
		}
		if time.Now().After(limite) {
			t.Fatalf("no llego el aviso a quien recibe: %v", err)
		}
		time.Sleep(100 * time.Millisecond)
	}
	if titulo != "SINPE received" {
		t.Fatalf("titulo del aviso = %q, se esperaba en ingles", titulo)
	}
	// Y el monto como lo escribe la app, con los miles separados: antes
	// llegaba "₡10000.00".
	if cuerpo != "You received ₡10,000.00 via SINPE Móvil" {
		t.Fatalf("cuerpo del aviso = %q, se esperaba en ingles y con el monto como la app", cuerpo)
	}
}
