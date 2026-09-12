package uif_test

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/kiramopay/backend/internal/uif"
)

// La cola de cumplimiento no podia recibir un caso: los umbrales legales se
// comparaban contra un movimiento y contra un dia, y los topes de KYC cortan
// antes. Repartido en dias, el dinero no se veia.

// salida inserta una salida completada de hace `dias` dias.
func salida(t *testing.T, pool *pgxpool.Pool, userID string, monto int64, dias int) string {
	t.Helper()
	ctx := context.Background()
	var walletID string
	if err := pool.QueryRow(ctx,
		`SELECT id::text FROM wallets WHERE user_id = $1::uuid`, userID).Scan(&walletID); err != nil {
		t.Fatalf("buscar billetera: %v", err)
	}
	id := uuid.New().String()
	if _, err := pool.Exec(ctx, `
		INSERT INTO transactions (id, wallet_id, user_id, type, amount, currency, status,
		                          created_at, completed_at)
		VALUES ($1::uuid, $2::uuid, $3::uuid, 'sinpe_send', $4, 'CRC', 'completed',
		        NOW() - make_interval(days => $5::int), NOW() - make_interval(days => $5::int))`,
		id, walletID, userID, monto, dias); err != nil {
		t.Fatalf("insertar salida: %v", err)
	}
	return id
}

func casosDe(t *testing.T, pool *pgxpool.Pool, userID, tipo string) []int64 {
	t.Helper()
	rows, err := pool.Query(context.Background(),
		`SELECT COALESCE(acumulado_30d_minor, 0) FROM uif_reports WHERE user_id = $1::uuid AND report_type = $2`,
		userID, tipo)
	if err != nil {
		t.Fatalf("leer casos: %v", err)
	}
	defer rows.Close()
	var out []int64
	for rows.Next() {
		var v int64
		if err := rows.Scan(&v); err != nil {
			t.Fatalf("scan: %v", err)
		}
		out = append(out, v)
	}
	return out
}

func TestUnMesRepartidoEnDiasLlegaALaCola(t *testing.T) {
	svc, _, pool, userID := setupUIF(t)
	ctx := context.Background()
	umbral := uif.DefaultThresholds().Acumulado30["CRC"]

	// Veinte dias de ₡250.000 (₡5.000.000): ningun dia llega a nada, y el
	// acumulado queda por debajo del umbral de ₡5.500.000.
	for d := 20; d >= 1; d-- {
		salida(t, pool, userID, 25_000_000, d)
	}
	// Una salida de hace 40 dias NO cuenta: esta fuera de la ventana.
	salida(t, pool, userID, 300_000_000, 40)

	// Hoy, ₡600.000 mas: el acumulado de 30 dias cruza.
	hoy := salida(t, pool, userID, 60_000_000, 0)
	svc.Report(ctx, userID, hoy, "CRC", 60_000_000)

	casos := casosDe(t, pool, userID, uif.TypeAcumulado30)
	if len(casos) != 1 {
		t.Fatalf("casos acumulado_30d = %d, se esperaba 1", len(casos))
	}
	if want := int64(20*25_000_000 + 60_000_000); casos[0] != want {
		t.Fatalf("acumulado registrado = %d, se esperaba %d (la salida de hace 40 dias no cuenta)", casos[0], want)
	}
	if casos[0] < umbral {
		t.Fatalf("se abrio un caso con %d, por debajo del umbral %d", casos[0], umbral)
	}

	// Una salida mas, ya por encima: no se repite el caso.
	otra := salida(t, pool, userID, 1_000_000, 0)
	svc.Report(ctx, userID, otra, "CRC", 1_000_000)
	if n := len(casosDe(t, pool, userID, uif.TypeAcumulado30)); n != 1 {
		t.Fatalf("casos tras seguir por encima = %d, se esperaba 1", n)
	}

	// Y es un caso para REVISAR: nace pendiente, nadie lo envio a la UIF.
	var estado string
	if err := pool.QueryRow(ctx,
		`SELECT status FROM uif_reports WHERE user_id = $1::uuid AND report_type = $2`,
		userID, uif.TypeAcumulado30).Scan(&estado); err != nil {
		t.Fatalf("leer estado: %v", err)
	}
	if estado != uif.StatusPending {
		t.Fatalf("estado = %q, se esperaba pending", estado)
	}
}

// Si el dia ya cruzo, ese caso es mas especifico que el del mes: uno por
// movimiento alcanza.
func TestSiElDiaCruzaNoSeDuplicaConElMes(t *testing.T) {
	svc, _, pool, userID := setupUIF(t)
	ctx := context.Background()

	hoy := salida(t, pool, userID, 600_000_000, 0) // ₡6.000.000 de una vez
	svc.Report(ctx, userID, hoy, "CRC", 600_000_000)

	if n := len(casosDe(t, pool, userID, uif.TypeAcumulado30)); n != 0 {
		t.Fatalf("casos acumulado_30d = %d, se esperaba 0 (ya hay un caso por el movimiento)", n)
	}
	if n := len(casosDe(t, pool, userID, uif.TypeSingleThreshold)); n != 1 {
		t.Fatalf("casos single_threshold = %d, se esperaba 1", n)
	}
}
