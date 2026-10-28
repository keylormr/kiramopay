package reservas_test

import (
	"context"
	"os"
	"testing"

	"github.com/kiramopay/backend/internal/ledger"
	"github.com/kiramopay/backend/internal/testutil"
)

// Migracion 089: el asiento de apertura. El arreglo de las reservas detiene el
// descuadre pero no borra el que ya hay en produccion: la migracion calcula, en
// cada moneda, pasivo menos reserva en el momento de correr y lo asienta entre
// el capital propio y la reserva. Si falta, el capital pone; si sobra, la
// reserva devuelve; con diferencia cero no asienta nada. Es un asiento nuevo de
// partida doble con una referencia fija: el libro es inmutable y correrla de
// nuevo no repite nada.
//
// Los montos son los de produccion al 28-10: faltan 19.670 unidades menores de
// colones (pasivo 625.769.670, reserva 625.750.000) y sobran 5.500 de dolares
// (pasivo 129.000, reserva 134.500).

const (
	faltanColones = int64(19_670)
	sobranDolares = int64(5_500)
)

func correr089(t *testing.T, m *mundo) {
	t.Helper()
	sql, err := os.ReadFile("../../migrations/089_apertura_de_la_reserva.sql")
	if err != nil {
		t.Fatalf("leer la migracion: %v", err)
	}
	if _, err := m.pool.Exec(context.Background(), string(sql)); err != nil {
		t.Fatalf("correr la migracion: %v", err)
	}
}

// descuadrar deja la base como produccion: en colones el pasivo le gana a la
// reserva, y en dolares la reserva le gana al pasivo. Va por el motor del
// libro, asientos de partida doble contra la cuenta de suspenso, para no
// escribir saldos a mano.
func descuadrar(t *testing.T, m *mundo) {
	t.Helper()
	ctx := context.Background()
	// Se le acredita a una persona sin que la reserva lo respalde: sube el pasivo.
	if _, err := m.eng.Post(ctx, &ledger.Posting{
		Description: "TEST_FALTA_RESERVA",
		CreatedBy:   m.user,
		Entries: []ledger.Entry{
			{Account: ledger.Account{SystemCode: ledger.SystemSuspenseCRC}, Side: ledger.Debit, AmountMinor: faltanColones, Currency: "CRC"},
			{Account: ledger.Account{UserID: m.user}, Side: ledger.Credit, AmountMinor: faltanColones, Currency: "CRC"},
		},
	}); err != nil {
		t.Fatalf("crear la falta de reserva: %v", err)
	}
	// Entra plata a la reserva que no es de nadie: sube la reserva.
	if _, err := m.eng.Post(ctx, &ledger.Posting{
		Description: "TEST_SOBRA_RESERVA",
		CreatedBy:   m.user,
		Entries: []ledger.Entry{
			{Account: ledger.Account{SystemCode: ledger.SystemReserveUSD}, Side: ledger.Debit, AmountMinor: sobranDolares, Currency: "USD"},
			{Account: ledger.Account{SystemCode: ledger.SystemSuspenseUSD}, Side: ledger.Credit, AmountMinor: sobranDolares, Currency: "USD"},
		},
	}); err != nil {
		t.Fatalf("crear la sobra de reserva: %v", err)
	}
}

func (m *mundo) diferencias(t *testing.T) (crc, usd int64) {
	t.Helper()
	saldos, err := testutil.ReservaYPasivo(context.Background(), m.pool)
	if err != nil {
		t.Fatalf("%v", err)
	}
	return saldos["CRC"].Diferencia(), saldos["USD"].Diferencia()
}

func (m *mundo) contar(t *testing.T, consulta string, args ...any) int {
	t.Helper()
	var n int
	if err := m.pool.QueryRow(context.Background(), consulta, args...).Scan(&n); err != nil {
		t.Fatalf("contar: %v", err)
	}
	return n
}

func (m *mundo) asientosDeApertura(t *testing.T) int {
	t.Helper()
	return m.contar(t, `SELECT COUNT(*) FROM journal_postings WHERE idempotency_key LIKE 'migracion:089:%'`)
}

func (m *mundo) rastroEnAuditoria(t *testing.T) int {
	t.Helper()
	return m.contar(t, `SELECT COUNT(*) FROM audit_logs WHERE action = 'apertura_de_reserva'`)
}

// Una base con descuadre en las dos monedas: despues de la migracion, la
// reserva es igual al pasivo en cada una, el capital puso lo que faltaba en
// colones y recibio lo que sobraba en dolares, y queda rastro.
func TestMigracion089_UnaBaseConDescuadreQuedaAlCien(t *testing.T) {
	m := montar(t)
	descuadrar(t, m)

	crc, usd := m.diferencias(t)
	if crc != -faltanColones || usd != sobranDolares {
		t.Fatalf("la base no quedo como produccion: diferencia CRC %d (se esperaba %d), USD %d (se esperaba %d)",
			crc, -faltanColones, usd, sobranDolares)
	}
	entradasAntes := m.contar(t, `SELECT COUNT(*) FROM journal_entries`)

	correr089(t, m)

	m.iguales(t, "el asiento de apertura")
	// Si falta, el capital pone: queda en negativo por lo que puso. Si sobra, la
	// reserva devuelve: el capital recibe.
	m.exigirCapital(t, "CRC", -faltanColones, "la apertura: el capital puso lo que faltaba")
	m.exigirCapital(t, "USD", sobranDolares, "la apertura: la reserva devolvio lo que sobraba")
	if n := m.asientosDeApertura(t); n != 2 {
		t.Errorf("asientos de apertura = %d, se esperaban 2 (uno por moneda)", n)
	}
	// Solo se agregaron entradas: dos asientos de dos patas.
	if n := m.contar(t, `SELECT COUNT(*) FROM journal_entries`); n != entradasAntes+4 {
		t.Errorf("entradas del libro = %d, se esperaban %d: la apertura solo agrega", n, entradasAntes+4)
	}
	if n := m.rastroEnAuditoria(t); n != 2 {
		t.Errorf("filas en audit_logs = %d, se esperaban 2 (una por moneda)", n)
	}
}

// Una base cuadrada: no hay nada que abrir. Ni asiento, ni rastro, ni capital.
func TestMigracion089_UnaBaseCuadradaNoAsientaNada(t *testing.T) {
	m := montar(t)
	entradasAntes := m.contar(t, `SELECT COUNT(*) FROM journal_entries`)

	correr089(t, m)

	m.iguales(t, "la migracion sobre una base cuadrada")
	if n := m.asientosDeApertura(t); n != 0 {
		t.Errorf("asientos de apertura = %d, se esperaban 0", n)
	}
	if n := m.contar(t, `SELECT COUNT(*) FROM journal_entries`); n != entradasAntes {
		t.Errorf("entradas del libro = %d, se esperaban %d: con diferencia cero no se escribe nada", n, entradasAntes)
	}
	if n := m.rastroEnAuditoria(t); n != 0 {
		t.Errorf("filas en audit_logs = %d, se esperaban 0", n)
	}
	m.exigirCapital(t, "CRC", 0, "la migracion sobre una base cuadrada")
	m.exigirCapital(t, "USD", 0, "la migracion sobre una base cuadrada")
}

// Correrla dos veces deja un solo asiento por moneda. La referencia es fija:
// aunque despues aparezca otra diferencia, la apertura no se repite.
func TestMigracion089_CorrerlaDosVecesAsientaUnaSolaVez(t *testing.T) {
	m := montar(t)
	descuadrar(t, m)

	correr089(t, m)
	capitalCRC, capitalUSD := m.capital(t, "CRC"), m.capital(t, "USD")
	entradas := m.contar(t, `SELECT COUNT(*) FROM journal_entries`)

	correr089(t, m)

	if n := m.asientosDeApertura(t); n != 2 {
		t.Errorf("asientos de apertura = %d, se esperaban 2 aun corriendola dos veces", n)
	}
	if n := m.contar(t, `SELECT COUNT(*) FROM journal_entries`); n != entradas {
		t.Errorf("entradas del libro = %d, se esperaban %d: la segunda pasada no escribe", n, entradas)
	}
	m.exigirCapital(t, "CRC", capitalCRC, "correrla otra vez")
	m.exigirCapital(t, "USD", capitalUSD, "correrla otra vez")
	if n := m.rastroEnAuditoria(t); n != 2 {
		t.Errorf("filas en audit_logs = %d, se esperaban 2", n)
	}

	// Aunque aparezca otra diferencia despues, la apertura ya se hizo.
	descuadrar(t, m)
	correr089(t, m)
	if n := m.asientosDeApertura(t); n != 2 {
		t.Errorf("asientos de apertura = %d, se esperaban 2: la referencia es fija", n)
	}
}
