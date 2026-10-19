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
// antes. Repartido en dias, el dinero no se veia. La regla de 30 dias que lo
// arreglo quedo como alerta interna (TestUIF_LosTreintaDiasSonUnaAlertaInterna):
// el acumulado regulatorio es el mes calendario.

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

// Si un movimiento solo ya supera el umbral, ese es su caso: uno por movimiento
// alcanza, y la alerta de 30 dias no se abre encima.
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
