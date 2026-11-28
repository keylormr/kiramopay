package sinpe_test

import (
	"context"
	"testing"
	"time"
)

// Tocar "SINPE recibido" solo marcaba el aviso como leido. Ahora el aviso
// lleva el movimiento de quien RECIBE (su fila en transactions, la que ve en su
// actividad) y la app lo abre. El de quien envia no le sirve: no aparece en la
// actividad de quien recibe.

type avisoRecibido struct {
	userID, clave, tag string
	datos              map[string]any
}

type avisosConDatos struct{ llegaron chan avisoRecibido }

func (a *avisosConDatos) NotificarEnSuIdioma(_ context.Context, userID, clave string, datos map[string]any, tag string) error {
	a.llegaron <- avisoRecibido{userID: userID, clave: clave, tag: tag, datos: datos}
	return nil
}

func TestSend_ElAvisoLlevaElMovimientoDeQuienRecibe(t *testing.T) {
	avisos := &avisosConDatos{llegaron: make(chan avisoRecibido, 2)}
	svc, emisor, receptor, pool := sinpeConAvisos(t, avisos)

	res, err := enviarSinpe(svc, emisor, montoSinpe, "sinpe:aviso:movimiento")
	if err != nil {
		t.Fatalf("el envio: %v", err)
	}

	var aviso avisoRecibido
	select {
	case aviso = <-avisos.llegaron:
	case <-time.After(5 * time.Second):
		t.Fatal("no llego el aviso del envio")
	}
	if aviso.userID != receptor || aviso.tag != "transaction" {
		t.Fatalf("aviso = %+v, esperaba uno de tipo transaction para %s", aviso, receptor)
	}

	var deQuienRecibe string
	if err := pool.QueryRow(context.Background(),
		`SELECT id::text FROM transactions WHERE user_id = $1::uuid`, receptor).Scan(&deQuienRecibe); err != nil {
		t.Fatalf("leer el movimiento de quien recibe: %v", err)
	}
	movimiento, _ := aviso.datos["movimiento"].(string)
	if movimiento != deQuienRecibe {
		t.Fatalf("movimiento del aviso = %q, esperaba el de quien recibe %q", movimiento, deQuienRecibe)
	}
	if movimiento == res.TransactionID {
		t.Fatalf("el aviso lleva el movimiento de quien envia (%s)", res.TransactionID)
	}
	if _, ok := aviso.datos["monto"].(string); !ok {
		t.Fatalf("el aviso perdio el monto del texto: %v", aviso.datos)
	}
}
