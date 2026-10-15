package uif_test

import (
	"context"
	"errors"
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
}

// El dolar no necesita tipo de cambio: sin otras monedas en la ventana, un
// movimiento chico en dolares no abre nada aunque no haya tasa para ninguna.
func TestUIF_ElDolarSoloNoNecesitaTipoDeCambio(t *testing.T) {
	_, _, pool, userID := setupUIF(t)
	svc := servicioConTasa(pool, map[string]float64{})

	tx := salidaEn(t, pool, userID, "USD", 10_000) // US$100
	svc.Report(context.Background(), userID, tx, "USD", 10_000)
	if casos := casosDelUsuario(t, pool, userID); len(casos) != 0 {
		t.Fatalf("un movimiento chico en dolares, sin otras monedas, abrio casos: %+v", casos)
	}
}

// Un total que no se puede sumar entero no es un total que no cruza. Hoy salieron
// ₡500.000 (US$1.097,45 al tipo de 455,6) y no hay tipo de cambio para el colon;
// despues salen US$9.900. El dia suma de verdad US$10.997, pero sin la tasa el
// servicio solo veia los US$9.900, no cruzaba y no abria nada: el colon quedaba
// fuera con un aviso en el log. Ahora lo decide una persona.
func TestUIF_UnTotalQueNoSePuedeSumarEsUnCasoManual(t *testing.T) {
	_, _, pool, userID := setupUIF(t)
	svc := servicioConTasa(pool, map[string]float64{})
	ctx := context.Background()

	salidaEn(t, pool, userID, "CRC", 50_000_000) // ₡500.000, sin Report: ya paso
	tx := salidaEn(t, pool, userID, "USD", 990_000)
	svc.Report(ctx, userID, tx, "USD", 990_000)

	casos := casosDelUsuario(t, pool, userID)
	if len(casos) != 1 || casos[0].tipo != uif.TypeManual || casos[0].moneda != "USD" {
		t.Fatalf("casos = %+v, se esperaba uno manual por el movimiento en dolares", casos)
	}
	for _, dato := range []string{"CRC", "tipo de cambio", "9900.00"} {
		if !strings.Contains(casos[0].razon, dato) {
			t.Fatalf("la razon %q no dice %q", casos[0].razon, dato)
		}
	}
}

// El tipo de cambio se consultaba una vez para el movimiento y otra para cada
// total. Si la primera respondia y la segunda fallaba (un corte de la base, el
// contexto cancelado), el total salia SIN el colon, incluido el propio
// movimiento: US$6.000 de hoy y ₡2.750.000 (US$5.000 a 550) no cruzaban. Una
// evaluacion consulta cada moneda una sola vez.
func TestUIF_UnaFallaPasajeraDelTipoDeCambioNoSacaMonedasDelTotal(t *testing.T) {
	_, _, pool, userID := setupUIF(t)
	consultas := 0
	svc := uif.NewService(uif.NewRepository(pool), &uif.Options{
		TipoDeCambio: func(_ context.Context, moneda string) (float64, error) {
			consultas++
			if consultas > 1 {
				return 0, errors.New("se corto la base")
			}
			return 550, nil
		},
	})
	ctx := context.Background()

	salidaEn(t, pool, userID, "USD", 600_000)
	tx := salidaEn(t, pool, userID, "CRC", 275_000_000)
	svc.Report(ctx, userID, tx, "CRC", 275_000_000)

	casos := casosDelUsuario(t, pool, userID)
	if len(casos) != 1 || casos[0].tipo != uif.TypeStructuring {
		t.Fatalf("casos = %+v, se esperaba uno structuring: el colon tiene que contar en el total", casos)
	}
}

// Cuando dispara un total, la razon dice de que esta hecho: cuanto en cada
// moneda y con que tipo de cambio se convirtio. Sin eso, un caso disparado por
// un movimiento en dolares decia "las salidas del dia sumaron US$11000.00" y la
// columna del total guardaba solo los dolares: el oficial no podia rehacer la
// cuenta.
func TestUIF_LaRazonDelTotalDiceDeQueEstaHecho(t *testing.T) {
	_, _, pool, userID := setupUIF(t)
	svc := servicioConTasa(pool, map[string]float64{"CRC": 550})
	ctx := context.Background()

	salidaEn(t, pool, userID, "CRC", 275_000_000) // ₡2.750.000 = US$5.000
	tx := salidaEn(t, pool, userID, "USD", 600_000)
	svc.Report(ctx, userID, tx, "USD", 600_000)

	casos := casosDelUsuario(t, pool, userID)
	if len(casos) != 1 || casos[0].tipo != uif.TypeStructuring {
		t.Fatalf("casos = %+v, se esperaba uno structuring", casos)
	}
	for _, dato := range []string{"2750000.00 CRC", "US$5000.00", "550", "US$6000.00"} {
		if !strings.Contains(casos[0].razon, dato) {
			t.Fatalf("la razon %q no dice %q", casos[0].razon, dato)
		}
	}
}

// Un umbral en cero no es "sin umbral": con SingleUSD en 0 todo movimiento
// igualaba el umbral y cada uno abria un caso. Un umbral que no es positivo se
// reemplaza por el de la ley.
func TestUIF_UnUmbralEnCeroUsaElDeLaLey(t *testing.T) {
	_, _, pool, userID := setupUIF(t)
	svc := uif.NewService(uif.NewRepository(pool), &uif.Options{
		Thresholds:   &uif.Thresholds{},
		TipoDeCambio: tasaFija(map[string]float64{"CRC": 550}),
	})

	tx := salidaEn(t, pool, userID, "USD", 100) // US$1
	svc.Report(context.Background(), userID, tx, "USD", 100)
	if casos := casosDelUsuario(t, pool, userID); len(casos) != 0 {
		t.Fatalf("con los umbrales en cero US$1 abrio casos: %+v", casos)
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
