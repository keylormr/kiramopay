package b2b_test

import (
	"context"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"sync/atomic"
	"testing"
	"time"

	"github.com/kiramopay/backend/internal/b2b"
	"github.com/kiramopay/backend/internal/testutil"
)

// Mientras corre el plazo de la eliminacion la cuenta no recibe avisos, y un
// webhook es un aviso: ni se encolan eventos nuevos ni salen los que ya
// esperaban. Al reactivar, lo encolado sale; el endpoint no se toco.
func TestWebhook_NoSaleMientrasLaCuentaEstaPorEliminar(t *testing.T) {
	t.Setenv("B2B_ALLOW_PRIVATE_WEBHOOK_TARGETS", "1")
	pool := testutil.TestDB(t)
	userID := testutil.SeedTestUser(t, pool, "702650930", "dummy")
	repo := b2b.NewRepository(pool)
	logger := slog.New(slog.NewTextHandler(os.Stdout, nil))
	svc := b2b.NewService(repo, testCipher, nil, logger)
	ctx := context.Background()

	var recibidos atomic.Int32
	destino := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		recibidos.Add(1)
		w.WriteHeader(http.StatusOK)
	}))
	defer destino.Close()
	if _, err := svc.CreateEndpoint(ctx, userID, destino.URL, "*"); err != nil {
		t.Fatalf("crear endpoint: %v", err)
	}

	// Un evento que ya esperaba cuando la persona pidio la eliminacion.
	svc.Emit(ctx, userID, "escrow.funded", map[string]string{"id": "antes"})
	if _, err := pool.Exec(ctx, `UPDATE users
		SET status = 'pending_deletion', deletion_requested_at = NOW(),
		    deletion_due_at = NOW() + interval '30 days', deletion_terms_accepted_at = NOW(),
		    deletion_channel = 'in_app'
		WHERE id = $1::uuid`, userID); err != nil {
		t.Fatalf("marcar por eliminar: %v", err)
	}
	// Y otro que llega durante el plazo.
	svc.Emit(ctx, userID, "escrow.created", map[string]string{"id": "durante"})

	d := b2b.NewDispatcher(repo, testCipher, time.Second, logger)
	if n := d.RunOnce(ctx); n != 0 || recibidos.Load() != 0 {
		t.Fatalf("durante el plazo salieron %d entregas (%d recibidas)", n, recibidos.Load())
	}
	var encolados int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM webhook_deliveries`).Scan(&encolados); err != nil {
		t.Fatal(err)
	}
	if encolados != 1 {
		t.Fatalf("en la cola hay %d entregas; se esperaba solo la de antes del pedido", encolados)
	}

	// Reactivada, lo que esperaba sale.
	if _, err := pool.Exec(ctx, `UPDATE users
		SET status = 'active', deletion_requested_at = NULL, deletion_due_at = NULL,
		    deletion_terms_accepted_at = NULL, deletion_channel = NULL
		WHERE id = $1::uuid`, userID); err != nil {
		t.Fatalf("reactivar: %v", err)
	}
	if n := d.RunOnce(ctx); n != 1 || recibidos.Load() != 1 {
		t.Fatalf("reactivada salieron %d entregas (%d recibidas), se esperaba 1", n, recibidos.Load())
	}
}
