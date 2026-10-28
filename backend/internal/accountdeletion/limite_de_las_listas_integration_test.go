package accountdeletion

import (
	"context"
	"testing"

	"github.com/kiramopay/backend/internal/testutil"
)

// Las tres listas del panel de eliminacion de cuentas: sin pedido devuelven 50,
// y pedir mas que el tope (100) devuelve el tope. Antes volvian al valor por
// defecto: `limit=500` traia 50, menos que `limit=100`. Es el mismo defecto que
// tenia GET /transactions (ver transaction.ListByUser).

// Se siembran 120 filas de cada tabla: mas que el tope, para que un limite mal
// recortado se vea.
func TestLasListasDelPanelRecortanAlTopeYNoAlValorPorDefecto(t *testing.T) {
	pool := testutil.TestDB(t)
	a := sembrar(t, pool)
	svc := nuevoServicio(pool, &Options{})
	ctx := context.Background()

	// Cola de solicitudes verificadas (sin cuenta: la ficha no hace falta).
	exec(t, pool, `
		INSERT INTO account_deletion_requests (contact_kind, contact_hash, status, terms_accepted_at, verified_at)
		SELECT 'email', md5(g::text) || md5(g::text), 'verified', NOW(), NOW() - (g || ' minutes')::interval
		  FROM generate_series(1, 120) g`)
	// Respuestas escritas que pasaron a operaciones, y respuestas enviadas a un
	// correo sin confirmar: las dos de la misma cuenta.
	exec(t, pool, `
		INSERT INTO account_deletion_responses (user_id, kind, respond_by, escalated_at)
		SELECT $1::uuid, 'blocked', NOW() + (g || ' hours')::interval, NOW()
		  FROM generate_series(1, 120) g`, a.ID)
	exec(t, pool, `
		INSERT INTO account_deletion_responses
		       (user_id, kind, respond_by, email_unconfirmed, delivered_at, delivered_via)
		SELECT $1::uuid, 'blocked', NOW(), true, NOW() - (g || ' minutes')::interval, 'email'
		  FROM generate_series(1, 120) g`, a.ID)

	casos := []struct {
		nombre string
		lista  func(limite int) (int, error)
	}{
		{"solicitudes verificadas", func(l int) (int, error) {
			r, err := svc.ListarVerificadas(ctx, l)
			return len(r), err
		}},
		{"respuestas sin entregar", func(l int) (int, error) {
			r, err := svc.RespuestasSinEntregar(ctx, l)
			return len(r), err
		}},
		{"enviadas sin confirmar", func(l int) (int, error) {
			r, err := svc.EnviadasSinConfirmar(ctx, l)
			return len(r), err
		}},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			for _, p := range []struct{ pedido, esperado int }{
				{0, 50},    // sin pedido: el valor por defecto
				{-3, 50},   // un pedido invalido tampoco
				{20, 20},   // dentro del tope: se respeta
				{100, 100}, // justo el tope
				{500, 100}, // pasado el tope: el tope, no el valor por defecto
			} {
				got, err := c.lista(p.pedido)
				if err != nil {
					t.Fatalf("limit=%d: %v", p.pedido, err)
				}
				if got != p.esperado {
					t.Errorf("limit=%d devolvio %d filas, se esperaban %d", p.pedido, got, p.esperado)
				}
			}
		})
	}
}
