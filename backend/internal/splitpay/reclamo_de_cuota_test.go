package splitpay

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// El reclamo de la cuota es lo que corre DENTRO de la transaccion del asiento.
// Que devuelva error cuando no cambio ninguna fila no es un detalle: ese error
// es lo que hace que el libro deshaga el movimiento y el dinero no salga.

// txQueDevuelveFilas hace de transaccion: solo se le llama Exec.
type txQueDevuelveFilas struct {
	pgx.Tx
	filas int
	sql   string
}

func (t *txQueDevuelveFilas) Exec(_ context.Context, sql string, _ ...interface{}) (pgconn.CommandTag, error) {
	t.sql = sql
	return pgconn.NewCommandTag(fmt.Sprintf("UPDATE %d", t.filas)), nil
}

func TestReclamarCuotaEnTx_SinFilaAfectadaAvisaEnVezDeDarPorBuenoElCobro(t *testing.T) {
	ctx := context.Background()

	sinFilas := &txQueDevuelveFilas{}
	if err := ReclamarCuotaEnTx(ctx, sinFilas, "grupo", "persona"); !errors.Is(err, ErrCuotaNoReclamable) {
		t.Fatalf("error = %v, se esperaba ErrCuotaNoReclamable: sin este error el asiento confirma y el dinero sale igual", err)
	}
	// La guarda tiene que estar en el SQL: es lo que hace que el reclamo sea
	// exclusivo contra un rechazo simultaneo, no una comprobacion previa.
	if !strings.Contains(sinFilas.sql, "status = 'pending'") {
		t.Fatalf("el reclamo no exige que la cuota siga pendiente: %s", sinFilas.sql)
	}

	conFila := &txQueDevuelveFilas{filas: 1}
	if err := ReclamarCuotaEnTx(ctx, conFila, "grupo", "persona"); err != nil {
		t.Fatalf("reclamar una cuota pendiente: %v", err)
	}
}
