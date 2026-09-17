package crypto

import (
	"context"
	"fmt"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// Lo unico que impide el abrazo mortal entre dos conversiones opuestas es que
// las dos pidan las filas en el MISMO orden. Esta prueba mira justo eso, sin
// base de datos: que el orden no dependa de cual activo es el de origen.

type queriaQueAnotaBloqueos struct{ simbolos []string }

func (q *queriaQueAnotaBloqueos) Exec(context.Context, string, ...interface{}) (pgconn.CommandTag, error) {
	return pgconn.CommandTag{}, nil
}

func (q *queriaQueAnotaBloqueos) QueryRow(_ context.Context, sql string, args ...interface{}) pgx.Row {
	if strings.Contains(sql, "FOR UPDATE") && len(args) == 2 {
		q.simbolos = append(q.simbolos, fmt.Sprint(args[1]))
	}
	return filaConUno{}
}

// filaConUno hace de fila existente: el bloqueo la encontro.
type filaConUno struct{}

func (filaConUno) Scan(dest ...any) error {
	if len(dest) == 1 {
		if n, ok := dest[0].(*int); ok {
			*n = 1
		}
	}
	return nil
}

func TestBloquearActivos_ElOrdenNoDependeDelSentidoDeLaConversion(t *testing.T) {
	ctx := context.Background()

	ida := &queriaQueAnotaBloqueos{}
	if err := bloquearActivosEnOrden(ctx, ida, "u", "BTC", "ETH"); err != nil {
		t.Fatalf("bloquear BTC a ETH: %v", err)
	}
	vuelta := &queriaQueAnotaBloqueos{}
	if err := bloquearActivosEnOrden(ctx, vuelta, "u", "ETH", "BTC"); err != nil {
		t.Fatalf("bloquear ETH a BTC: %v", err)
	}

	quiere := []string{"BTC", "ETH"}
	for nombre, got := range map[string][]string{"BTC a ETH": ida.simbolos, "ETH a BTC": vuelta.simbolos} {
		if len(got) != len(quiere) {
			t.Fatalf("%s tomo %v, se esperaba %v", nombre, got, quiere)
		}
		for i := range quiere {
			if got[i] != quiere[i] {
				t.Fatalf("%s tomo %v, se esperaba %v: dos sentidos con ordenes distintos se abrazan", nombre, got, quiere)
			}
		}
	}
}

// Pedir dos veces el mismo simbolo no puede convertirse en dos bloqueos: el
// segundo seria sobre una fila que esta transaccion ya tiene.
func TestBloquearActivos_UnSimboloRepetidoSeTomaUnaSolaVez(t *testing.T) {
	q := &queriaQueAnotaBloqueos{}
	if err := bloquearActivosEnOrden(context.Background(), q, "u", "SOL", "SOL", ""); err != nil {
		t.Fatalf("bloquear SOL: %v", err)
	}
	if len(q.simbolos) != 1 || q.simbolos[0] != "SOL" {
		t.Fatalf("se tomaron %v, se esperaba [SOL]", q.simbolos)
	}
}
