package splitpay_test

import (
	"context"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/kiramopay/backend/internal/ledger"
	"github.com/kiramopay/backend/internal/middleware"
	"github.com/kiramopay/backend/internal/splitpay"
	"github.com/kiramopay/backend/internal/testutil"
	"github.com/kiramopay/backend/internal/transaction"
	"github.com/kiramopay/backend/internal/user"
	"github.com/kiramopay/backend/internal/wallet"
)

// mfaSinVerificar exige el segundo factor y no hay ninguno verificado: la
// cuota de la division lo cruza con el motor de transferencias de verdad.
type mfaSinVerificar struct{}

func (mfaSinVerificar) IsMFARequired(int64, string) bool { return true }
func (mfaSinVerificar) HasVerifiedMFA(context.Context, string, string) (bool, error) {
	return false, nil
}

// La cuota que pasa el umbral sin segundo factor sale por la ruta como 428
// MFA_REQUIRED, igual que cualquier otra salida: la pantalla abre el desafio en
// vez de decir que el pago fallo. Y no se movio nada: ni dinero ni la cuota.
func TestPagarCuota_SinSegundoFactorResponde428PorLaRuta(t *testing.T) {
	pool := testutil.TestDB(t)
	creador := testutil.SeedTestUser(t, pool, "702650930", "dummy")
	segundo := testutil.SeedTestUser2(t, pool)
	testutil.SeedTestUser3(t, pool)

	l := ledger.NewEngine(pool, slog.New(slog.NewJSONHandler(os.Stdout, nil)))
	txSvc := transaction.NewService(transaction.NewRepository(pool), wallet.NewRepository(pool), l,
		&transaction.Options{MFA: mfaSinVerificar{}})
	svc := splitpay.NewService(splitpay.NewRepository(pool), txSvc, user.NewRepository(pool))
	grupo := divisionDeTres(t, svc, creador, "Cena")

	creador0, segundo0 := saldoCRC(t, pool, creador), saldoCRC(t, pool, segundo)

	h := splitpay.NewHandler(svc)
	router := chi.NewRouter()
	router.Post("/api/v1/splits/{id}/pay", func(w http.ResponseWriter, r *http.Request) {
		h.PayShare(w, r.WithContext(context.WithValue(r.Context(), middleware.UserIDKey, segundo)))
	})
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/v1/splits/"+grupo.ID+"/pay", nil))

	if rec.Code != http.StatusPreconditionRequired || !strings.Contains(rec.Body.String(), `"MFA_REQUIRED"`) {
		t.Fatalf("respuesta = %d %s, se esperaba 428 MFA_REQUIRED", rec.Code, rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), "settle split share") {
		t.Errorf("la respuesta deja ver el error interno: %s", rec.Body.String())
	}
	if got := saldoCRC(t, pool, segundo); got != segundo0 {
		t.Errorf("saldo de quien intento pagar = %d, se esperaba %d", got, segundo0)
	}
	if got := saldoCRC(t, pool, creador); got != creador0 {
		t.Errorf("saldo del creador = %d, se esperaba %d", got, creador0)
	}
	_, cuotas, err := svc.GetSplit(context.Background(), grupo.ID)
	if err != nil {
		t.Fatalf("leer la division: %v", err)
	}
	if c := cuotaDe(t, cuotas, segundo); c.Status != "pending" {
		t.Errorf("la cuota quedo %q, se esperaba pending: el pago no se hizo", c.Status)
	}
}
