package capital_test

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kiramopay/backend/internal/capital"
	"github.com/kiramopay/backend/internal/ledger"
	"github.com/kiramopay/backend/internal/testutil"
)

// El dato sale del libro: el saldo de SYSTEM:CAPITAL:<moneda>, derivado del
// diario, nunca calculado en la pantalla ni guardado aparte.

func montar(t *testing.T) (*pgxpool.Pool, *capital.Handler, *ledger.Engine) {
	t.Helper()
	pool := testutil.TestDB(t)
	eng := ledger.NewEngine(pool, slog.New(slog.NewJSONHandler(io.Discard, nil)))
	return pool, capital.NewHandler(capital.NewRepository(pool)), eng
}

// asentar escribe un asiento entre la reserva y el capital, que es lo que hacen
// las operaciones reales (una venta de cripto, un cashback, una comision).
func asentar(t *testing.T, eng *ledger.Engine, llave string, entradas []ledger.Entry) {
	t.Helper()
	if _, err := eng.Post(context.Background(), &ledger.Posting{
		Description: "prueba del capital propio", IdempotencyKey: llave, Entries: entradas,
	}); err != nil {
		t.Fatalf("asiento %s: %v", llave, err)
	}
}

func saldoDelLibro(t *testing.T, pool *pgxpool.Pool, codigo string) int64 {
	t.Helper()
	var saldo int64
	if err := pool.QueryRow(context.Background(),
		`SELECT balance_minor FROM ledger_account_balances WHERE code = $1`, codigo).Scan(&saldo); err != nil {
		t.Fatalf("leer %s del libro: %v", codigo, err)
	}
	return saldo
}

func moneda(t *testing.T, sobre sobreJSON, codigo string) monedaJSON {
	t.Helper()
	for _, m := range sobre.Data.Currencies {
		if m.Currency == codigo {
			return m
		}
	}
	t.Fatalf("la respuesta no trae %s: %+v", codigo, sobre.Data.Currencies)
	return monedaJSON{}
}

func TestCapital_SinMovimientosEstaEnCeroEnLasDosMonedas(t *testing.T) {
	_, h, _ := montar(t)
	estado, sobre, cuerpo := pedir(t, h)
	if estado != http.StatusOK {
		t.Fatalf("respuesta %d: %s", estado, cuerpo)
	}
	if len(sobre.Data.Currencies) != 2 {
		t.Fatalf("se esperaban CRC y USD, llego %+v", sobre.Data.Currencies)
	}
	for _, codigo := range []string{"CRC", "USD"} {
		if m := moneda(t, sobre, codigo); m.BalanceMinor != 0 || m.ShortfallMinor != 0 || m.Negative {
			t.Errorf("%s = %+v, se esperaba cero sin faltante", codigo, m)
		}
	}
}

// El caso de produccion: el capital de colones en -19.670 (196,70 colones).
func TestCapital_EnNegativoDiceCuantoFaltaYSoloEnEsaMoneda(t *testing.T) {
	pool, h, eng := montar(t)
	// El capital manda 30.000 a la reserva (una venta de cripto, un cashback) y
	// despues le vuelven 10.330 (una comision): queda en -19.670.
	asentar(t, eng, "capital:sale", ledger.CapitalAReserva("CRC", 30_000))
	asentar(t, eng, "capital:entra", ledger.ReservaACapital("CRC", 10_330))

	_, sobre, cuerpo := pedir(t, h)
	crc := moneda(t, sobre, "CRC")
	if crc.BalanceMinor != -19_670 || crc.ShortfallMinor != 19_670 || !crc.Negative {
		t.Fatalf("CRC = %+v, se esperaba saldo -19670, faltante 19670 y negativo: %s", crc, cuerpo)
	}
	if usd := moneda(t, sobre, "USD"); usd.BalanceMinor != 0 || usd.Negative {
		t.Errorf("USD = %+v: lo que pase en colones no mueve dolares", usd)
	}
	// El numero que sale es EL del libro.
	if libro := saldoDelLibro(t, pool, "SYSTEM:CAPITAL:CRC"); libro != crc.BalanceMinor {
		t.Errorf("el endpoint dice %d y el libro %d", crc.BalanceMinor, libro)
	}
}

func TestCapital_EnPositivoNoTieneFaltante(t *testing.T) {
	_, h, eng := montar(t)
	asentar(t, eng, "capital:usd", ledger.ReservaACapital("USD", 5_000))

	_, sobre, _ := pedir(t, h)
	usd := moneda(t, sobre, "USD")
	if usd.BalanceMinor != 5_000 || usd.ShortfallMinor != 0 || usd.Negative {
		t.Fatalf("USD = %+v, se esperaba saldo 5000 sin faltante", usd)
	}
}

// Un capital en negativo NO bloquea nada: el libro acepta el asiento que lo deja
// ahi. Esta prueba fija la decision del dueno ("Permitir y avisar") para que
// nadie le ponga un piso a la cuenta sin darse cuenta de lo que rompe.
func TestCapital_LasOperacionesSiguenAunqueQuedeEnNegativo(t *testing.T) {
	pool, _, eng := montar(t)
	asentar(t, eng, "capital:primera", ledger.CapitalAReserva("CRC", 1_000))
	asentar(t, eng, "capital:segunda", ledger.CapitalAReserva("CRC", 1_000))

	if got := saldoDelLibro(t, pool, "SYSTEM:CAPITAL:CRC"); got != -2_000 {
		t.Fatalf("el capital quedo en %d, se esperaba -2000", got)
	}
}

// Un fallo de la base es un 503 sin monedas: un cero seria una afirmacion.
func TestCapital_SiLaBaseFallaDiceQueFalla(t *testing.T) {
	testutil.TestDB(t) // arma el esquema; el pool de abajo es otro y se cierra
	cerrado := testutil.PoolTrazado(t, nil)
	cerrado.Close()
	h := capital.NewHandler(capital.NewRepository(cerrado))

	estado, sobre, cuerpo := pedir(t, h)
	if estado != http.StatusServiceUnavailable || sobre.Error.Code != "CAPITAL_UNAVAILABLE" {
		t.Fatalf("respuesta = %d %q, se esperaba 503 CAPITAL_UNAVAILABLE: %s", estado, sobre.Error.Code, cuerpo)
	}
}
