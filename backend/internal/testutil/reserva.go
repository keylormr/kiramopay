package testutil

import (
	"context"
	"fmt"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

// SaldoDeReserva es, para una moneda, lo que hay en la reserva y lo que se le
// debe a la gente.
type SaldoDeReserva struct {
	Reserva int64
	Pasivo  int64
}

// Diferencia es reserva menos pasivo: cero si la reserva cubre exactamente lo
// que se debe, negativa si falta, positiva si sobra.
func (s SaldoDeReserva) Diferencia() int64 { return s.Reserva - s.Pasivo }

// ReservaYPasivo lee, por moneda, la reserva y el pasivo con los usuarios con
// la MISMA definicion que usa la prueba de reservas publica
// (transparency.ProofOfReserves): el pasivo es la billetera de cada persona, el
// saldo de cada comercio, lo apartado en metas de ahorro y lo retenido en
// escrow; la reserva es la cuenta de tipo 'reserve'.
//
// Devuelve siempre CRC y USD, aunque esten en cero.
func ReservaYPasivo(ctx context.Context, pool *pgxpool.Pool) (map[string]SaldoDeReserva, error) {
	salida := map[string]SaldoDeReserva{"CRC": {}, "USD": {}}
	filas, err := pool.Query(ctx, `
		SELECT currency,
		       COALESCE(SUM(CASE WHEN type IN ('user_wallet', 'merchant_wallet')
		                           OR code LIKE 'SYSTEM:SAVINGS:%'
		                           OR code LIKE 'SYSTEM:ESCROW:%'
		                         THEN balance_minor ELSE 0 END), 0) AS pasivo,
		       COALESCE(SUM(CASE WHEN type = 'reserve' THEN balance_minor ELSE 0 END), 0) AS reserva
		  FROM ledger_account_balances
		 GROUP BY currency`)
	if err != nil {
		return nil, fmt.Errorf("leer reserva y pasivo: %w", err)
	}
	defer filas.Close()
	for filas.Next() {
		var moneda string
		var s SaldoDeReserva
		if err := filas.Scan(&moneda, &s.Pasivo, &s.Reserva); err != nil {
			return nil, fmt.Errorf("leer reserva y pasivo: %w", err)
		}
		salida[moneda] = s
	}
	return salida, filas.Err()
}

// ExigirReservaIgualAlPasivo falla la prueba si, en alguna moneda, la reserva
// no es EXACTAMENTE igual a lo que se les debe a los usuarios. Es el invariante
// "siempre al 100 %": se comprueba despues de cada tipo de operacion, y no hay
// tolerancia, ni de un centimo ni de un porcentaje.
//
// `tras` nombra la operacion que acaba de correr, para que el mensaje diga cual
// descuadro la reserva.
func ExigirReservaIgualAlPasivo(t *testing.T, pool *pgxpool.Pool, tras string) {
	t.Helper()
	saldos, err := ReservaYPasivo(context.Background(), pool)
	if err != nil {
		t.Fatalf("%v", err)
	}
	for _, moneda := range []string{"CRC", "USD"} {
		s := saldos[moneda]
		if s.Reserva != s.Pasivo {
			t.Errorf("%s despues de %q: la reserva es %d y el pasivo con los usuarios es %d (diferencia %d, reserva menos pasivo)",
				moneda, tras, s.Reserva, s.Pasivo, s.Diferencia())
		}
	}
}
