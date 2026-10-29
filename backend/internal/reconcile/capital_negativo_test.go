package reconcile_test

import (
	"bytes"
	"context"
	"io"
	"log/slog"
	"strings"
	"testing"
	"time"

	"github.com/kiramopay/backend/internal/ledger"
	"github.com/kiramopay/backend/internal/reconcile"
	"github.com/kiramopay/backend/internal/testutil"
)

// El capital propio puede quedar en negativo y las operaciones siguen (decision
// del dueno: "Permitir y avisar"). Ademas del panel de administracion, el
// servidor deja un registro WARN: la conciliacion periodica lo mira, sin poner un
// solo costo en el camino de cada operacion (sumar el diario de la cuenta de
// capital en cada asiento creceria con cada comision cobrada).

func asentarCapital(t *testing.T, llave string, entradas []ledger.Entry) (*bytes.Buffer, *reconcile.Service) {
	t.Helper()
	pool := testutil.TestDB(t)
	eng := ledger.NewEngine(pool, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if _, err := eng.Post(context.Background(), &ledger.Posting{
		Description: "prueba del aviso del capital", IdempotencyKey: llave, Entries: entradas,
	}); err != nil {
		t.Fatalf("asiento: %v", err)
	}
	var registro bytes.Buffer
	svc := reconcile.NewService(pool, nil, time.Hour, slog.New(slog.NewTextHandler(&registro, nil)))
	return &registro, svc
}

func TestReconcile_AvisaConUnWARNCuandoElCapitalEstaEnNegativo(t *testing.T) {
	registro, svc := asentarCapital(t, "reconcile:capital:negativo", ledger.CapitalAReserva("CRC", 19_670))

	if _, err := svc.RunOnce(context.Background()); err != nil {
		t.Fatalf("RunOnce: %v", err)
	}
	texto := registro.String()
	for _, esperado := range []string{
		`level=WARN msg="capital propio en negativo"`,
		"moneda=CRC",
		"saldo_minor=-19670",
		"faltante_minor=19670",
	} {
		if !strings.Contains(texto, esperado) {
			t.Errorf("el registro no dice %q:\n%s", esperado, texto)
		}
	}
	// Los dolares estan en cero: no hay nada que avisar de ellos.
	if strings.Contains(texto, "moneda=USD") {
		t.Errorf("avisa de una moneda que no esta en negativo:\n%s", texto)
	}
}

func TestReconcile_ConElCapitalEnPositivoNoAvisa(t *testing.T) {
	registro, svc := asentarCapital(t, "reconcile:capital:positivo", ledger.ReservaACapital("CRC", 5_000))

	if _, err := svc.RunOnce(context.Background()); err != nil {
		t.Fatalf("RunOnce: %v", err)
	}
	if texto := registro.String(); strings.Contains(texto, "capital propio en negativo") {
		t.Errorf("avisa con el capital en positivo:\n%s", texto)
	}
}
