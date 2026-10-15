package uif_test

import (
	"context"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/kiramopay/backend/internal/uif"
)

// La ley fija el umbral en US$10.000 o su equivalente en otras monedas. El
// umbral en colones era un numero fijo (₡5.500.000) que no seguia el tipo de
// cambio: con el colon a 455,6 equivalia a unos US$12.070, y un movimiento de
// US$11.000 en colones no llegaba a la cola. Una moneda sin umbral propio no se
// evaluaba nunca, y el agregado del dia sumaba cada moneda por separado.
// Ahora todo se compara por el equivalente en dolares con el tipo de cambio
// oficial, y sin tipo de cambio se abre un caso para que lo mire una persona.

// salidaEn inserta una salida completada de hoy en la moneda dada.
func salidaEn(t *testing.T, pool *pgxpool.Pool, userID, moneda string, monto int64) string {
	t.Helper()
	ctx := context.Background()
	var walletID string
	if err := pool.QueryRow(ctx,
		`SELECT id::text FROM wallets WHERE user_id = $1::uuid`, userID).Scan(&walletID); err != nil {
		t.Fatalf("buscar billetera: %v", err)
	}
	id := uuid.New().String()
	if _, err := pool.Exec(ctx, `
		INSERT INTO transactions (id, wallet_id, user_id, type, amount, currency, status, created_at, completed_at)
		VALUES ($1::uuid, $2::uuid, $3::uuid, 'sinpe_send', $4, $5, 'completed', NOW(), NOW())`,
		id, walletID, userID, monto, moneda); err != nil {
		t.Fatalf("insertar salida: %v", err)
	}
	return id
}

type caso struct{ tipo, moneda, razon string }

func casosDelUsuario(t *testing.T, pool *pgxpool.Pool, userID string) []caso {
	t.Helper()
	rows, err := pool.Query(context.Background(),
		`SELECT report_type, currency, reason FROM uif_reports WHERE user_id = $1::uuid ORDER BY created_at`, userID)
	if err != nil {
		t.Fatalf("leer casos: %v", err)
	}
	defer rows.Close()
	var out []caso
	for rows.Next() {
		var c caso
		if err := rows.Scan(&c.tipo, &c.moneda, &c.razon); err != nil {
			t.Fatalf("scan: %v", err)
		}
		out = append(out, c)
	}
	return out
}

func servicioConTasa(pool *pgxpool.Pool, porDolar map[string]float64) *uif.Service {
	return uif.NewService(uif.NewRepository(pool), &uif.Options{TipoDeCambio: tasaFija(porDolar)})
}

// ₡5.000.000 con el colon a 455,6 son US$10.974,54: supera el umbral, aunque
// quede por debajo de los ₡5.500.000 fijos de antes. El caso dice con que tipo
// de cambio y a cuantos dolares se comparo.
func TestUIF_ElUmbralEnColonesSigueAlTipoDeCambio(t *testing.T) {
	_, _, pool, userID := setupUIF(t)
	svc := servicioConTasa(pool, map[string]float64{"CRC": 455.6})

	tx := salidaEn(t, pool, userID, "CRC", 500_000_000)
	svc.Report(context.Background(), userID, tx, "CRC", 500_000_000)

	casos := casosDelUsuario(t, pool, userID)
	if len(casos) != 1 || casos[0].tipo != uif.TypeSingleThreshold {
		t.Fatalf("casos = %+v, se esperaba uno single_threshold", casos)
	}
	for _, dato := range []string{"10974.54", "455.60", "CRC"} {
		if !strings.Contains(casos[0].razon, dato) {
			t.Fatalf("la razon %q no dice %q", casos[0].razon, dato)
		}
	}
}

// El agregado del dia junta las monedas: US$6.000 y despues ₡2.750.000 (US$5.000
// a 550) suman US$11.000 y cruzan el umbral. Separadas, ninguna llegaba.
func TestUIF_ElDiaJuntaLasMonedas(t *testing.T) {
	_, _, pool, userID := setupUIF(t)
	svc := servicioConTasa(pool, map[string]float64{"CRC": 550})
	ctx := context.Background()

	primero := salidaEn(t, pool, userID, "USD", 600_000)
	svc.Report(ctx, userID, primero, "USD", 600_000)
	if n := len(casosDelUsuario(t, pool, userID)); n != 0 {
		t.Fatalf("US$6.000 solos abrieron %d casos", n)
	}

	segundo := salidaEn(t, pool, userID, "CRC", 275_000_000)
	svc.Report(ctx, userID, segundo, "CRC", 275_000_000)
	casos := casosDelUsuario(t, pool, userID)
	if len(casos) != 1 || casos[0].tipo != uif.TypeStructuring {
		t.Fatalf("casos = %+v, se esperaba uno structuring al cruzar con las dos monedas", casos)
	}
}

// Sin tipo de cambio, un movimiento en colones no se puede comparar con el
// umbral. Antes eso era silencio; ahora es un caso manual que dice por que.
// El dolar no necesita tipo de cambio: un movimiento chico en dolares no abre
// nada aunque no haya tasa para ninguna otra moneda.
func TestUIF_SinTipoDeCambioEsUnCasoManual(t *testing.T) {
	_, _, pool, userID := setupUIF(t)
	svc := servicioConTasa(pool, map[string]float64{})
	ctx := context.Background()

	tx := salidaEn(t, pool, userID, "CRC", 1_000_000) // ₡10.000
	svc.Report(ctx, userID, tx, "CRC", 1_000_000)
	casos := casosDelUsuario(t, pool, userID)
	if len(casos) != 1 || casos[0].tipo != uif.TypeManual || casos[0].moneda != "CRC" {
		t.Fatalf("casos = %+v, se esperaba uno manual en CRC", casos)
	}
	if !strings.Contains(casos[0].razon, "tipo de cambio") {
		t.Fatalf("la razon %q no dice que falto el tipo de cambio", casos[0].razon)
	}

	dolares := salidaEn(t, pool, userID, "USD", 10_000) // US$100
	svc.Report(ctx, userID, dolares, "USD", 10_000)
	if n := len(casosDelUsuario(t, pool, userID)); n != 1 {
		t.Fatalf("un movimiento chico en dolares abrio un caso: hay %d", n)
	}
}

// Una moneda sin umbral propio ya no queda fuera: €9.500 con el euro a 0,92 por
// dolar son US$10.326,09 y superan el umbral.
func TestUIF_UnaMonedaSinUmbralPropioSeComparaPorSuEquivalente(t *testing.T) {
	_, _, pool, userID := setupUIF(t)
	svc := servicioConTasa(pool, map[string]float64{"CRC": 550, "EUR": 0.92})

	tx := salidaEn(t, pool, userID, "EUR", 950_000)
	svc.Report(context.Background(), userID, tx, "EUR", 950_000)
	casos := casosDelUsuario(t, pool, userID)
	if len(casos) != 1 || casos[0].tipo != uif.TypeSingleThreshold || casos[0].moneda != "EUR" {
		t.Fatalf("casos = %+v, se esperaba uno single_threshold en EUR", casos)
	}
}
