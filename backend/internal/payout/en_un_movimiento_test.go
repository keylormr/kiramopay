package payout

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/kiramopay/backend/internal/transaction"
)

// submit eran tres pasos sueltos —reclamar, postear, compensar— y la
// compensacion tambien podia fallar. Ahora el tope, el reclamo y el historial
// corren dentro de la transaccion del asiento: o se confirman con el dinero o no
// se confirman.

func fijarTopes(t *testing.T, pool *pgxpool.Pool, userID string, diario, mensual int64) {
	t.Helper()
	if _, err := pool.Exec(context.Background(),
		`UPDATE wallets SET daily_limit = $2, monthly_limit = $3 WHERE user_id = $1::uuid`,
		userID, diario, mensual); err != nil {
		t.Fatalf("fijar topes: %v", err)
	}
}

// El tope que decide es el de ADENTRO del asiento. Se llama a submit directo,
// sin la comprobacion rapida de Create, para ejercitar solo esa.
func TestElTopeDentroDelAsientoNoDejaNadaAMedias(t *testing.T) {
	pool, svc, _, user := setup(t)
	ctx := context.Background()

	p, _, err := svc.repo.CreateOrGet(ctx, user, req("00012345", 150_000, "idem-tope"))
	if err != nil {
		t.Fatalf("CreateOrGet: %v", err)
	}
	fijarTopes(t, pool, user, 100_000, 10_000_000)
	antes := walletCRC(t, pool, user)

	if _, err := svc.submit(ctx, p); !errors.Is(err, transaction.ErrDailyLimitExceeded) {
		t.Fatalf("submit = %v, se esperaba ErrDailyLimitExceeded", err)
	}

	// Nada a medias: el payout sigue pendiente, la billetera intacta, la cuenta
	// del riel en cero y sin fila en el historial.
	actual, _ := svc.repo.Get(ctx, p.ID)
	if actual.Status != StatusPending {
		t.Fatalf("estado = %s, se esperaba pending (el reclamo no puede sobrevivir a un asiento revertido)", actual.Status)
	}
	if got := walletCRC(t, pool, user); got != antes {
		t.Fatalf("billetera = %d, se esperaba %d", got, antes)
	}
	if got := systemBalance(t, pool, mockExternalCRC); got != 0 {
		t.Fatalf("cuenta del riel = %d, se esperaba 0", got)
	}
	if got := countTx(t, pool, user, "payout_sent"); got != 0 {
		t.Fatalf("filas payout_sent = %d, se esperaba 0", got)
	}
}

// Dos payouts a la vez, cada uno por debajo del tope y juntos por encima. Con el
// tope comprobado por fuera, los dos leian la misma suma y los dos pasaban.
func TestDosPayoutsSimultaneosNoPasanElTope(t *testing.T) {
	pool, svc, _, user := setup(t)
	ctx := context.Background()
	fijarTopes(t, pool, user, 300_000, 10_000_000)
	antes := walletCRC(t, pool, user)

	var (
		wg      sync.WaitGroup
		salida  = make(chan struct{})
		mu      sync.Mutex
		errores []error
	)
	for _, idem := range []string{"idem-a", "idem-b"} {
		wg.Add(1)
		go func(idem string) {
			defer wg.Done()
			<-salida
			_, err := svc.Create(ctx, user, req("00012345", 200_000, idem))
			mu.Lock()
			errores = append(errores, err)
			mu.Unlock()
		}(idem)
	}
	close(salida)
	wg.Wait()

	pasaron, frenados := 0, 0
	for _, err := range errores {
		switch {
		case err == nil:
			pasaron++
		case errors.Is(err, transaction.ErrDailyLimitExceeded):
			frenados++
		default:
			t.Fatalf("error inesperado: %v", err)
		}
	}
	if pasaron != 1 || frenados != 1 {
		t.Fatalf("pasaron %d y frenados %d; se esperaba exactamente uno de cada", pasaron, frenados)
	}
	if got := walletCRC(t, pool, user); got != antes-200_000 {
		t.Fatalf("billetera = %d, se esperaba %d: el tope de 300.000 no puede dejar salir 400.000",
			got, antes-200_000)
	}
	if got := countTx(t, pool, user, "payout_sent"); got != 1 {
		t.Fatalf("filas payout_sent = %d, se esperaba 1", got)
	}
}

// Un payout frenado por el tope salia como 500 "operation failed": el handler no
// traducia el error y la pantalla no podia decir por que.
func TestElTopeLlegaConSuPropioCodigo(t *testing.T) {
	h := &Handler{}
	casos := map[error]string{
		transaction.ErrDailyLimitExceeded:   "DAILY_LIMIT_EXCEEDED",
		transaction.ErrMonthlyLimitExceeded: "MONTHLY_LIMIT_EXCEEDED",
	}
	for err, codigo := range casos {
		rec := httptest.NewRecorder()
		h.writeError(rec, err)
		if rec.Code != http.StatusUnprocessableEntity {
			t.Fatalf("%v: status = %d, se esperaba 422", err, rec.Code)
		}
		if !strings.Contains(rec.Body.String(), codigo) {
			t.Fatalf("%v: cuerpo = %s, se esperaba %s", err, rec.Body.String(), codigo)
		}
	}
}
