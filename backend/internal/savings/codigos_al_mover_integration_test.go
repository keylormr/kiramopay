package savings_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/kiramopay/backend/internal/middleware"
	"github.com/kiramopay/backend/internal/savings"
	"github.com/kiramopay/backend/internal/testutil"
)

type rechazoLeido struct {
	estado int
	codigo string
	cuerpo string
}

// pedirMovimiento deposita o retira por la ruta real, sin llave.
func pedirMovimiento(t *testing.T, svc *savings.Service, user, metaID, ruta string, monto int64) rechazoLeido {
	t.Helper()
	r := chi.NewRouter()
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			next.ServeHTTP(w, req.WithContext(context.WithValue(req.Context(), middleware.UserIDKey, user)))
		})
	})
	h := savings.NewHandler(svc)
	r.Post("/savings/goals/{id}/deposit", h.Deposit)
	r.Post("/savings/goals/{id}/withdraw", h.Withdraw)

	req := httptest.NewRequest(http.MethodPost, "/savings/goals/"+metaID+"/"+ruta,
		strings.NewReader(fmt.Sprintf(`{"amount_minor":%d}`, monto)))
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	var sobre struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &sobre); err != nil {
		t.Fatalf("respuesta ilegible %d: %v: %s", rec.Code, err, rec.Body.String())
	}
	return rechazoLeido{rec.Code, sobre.Error.Code, rec.Body.String()}
}

func guardadoEn(t *testing.T, svc *savings.Service, user, metaID string) int64 {
	t.Helper()
	metas, err := svc.List(context.Background(), user)
	if err != nil {
		t.Fatalf("listar metas: %v", err)
	}
	for _, g := range metas {
		if g.ID == metaID {
			return g.SavedMinor
		}
	}
	t.Fatalf("la meta %s no esta en la lista", metaID)
	return 0
}

// Depositar mas de lo que hay en la billetera respondia 400 SAVINGS_FAILED,
// igual que una falla de la base. Es el mismo motivo que SINPE y el pago con QR
// ya responden con INSUFFICIENT_BALANCE, y la pantalla lo dice igual.
func TestAhorro_DepositarSinSaldoEsInsufficientBalance(t *testing.T) {
	svc, pool, user := setupSavings(t)
	g := newGoal(t, svc, user)
	w0 := walletCRC(t, pool, user)

	r := pedirMovimiento(t, svc, user, g.ID, "deposit", w0+1)

	if r.estado != http.StatusUnprocessableEntity || r.codigo != "INSUFFICIENT_BALANCE" {
		t.Fatalf("respuesta = %d %s, se esperaba 422 INSUFFICIENT_BALANCE: %s", r.estado, r.codigo, r.cuerpo)
	}
	if got := walletCRC(t, pool, user); got != w0 {
		t.Fatalf("billetera = %d, se esperaba %d (nada se movio)", got, w0)
	}
	if got := guardadoEn(t, svc, user, g.ID); got != 0 {
		t.Fatalf("guardado = %d, se esperaba 0", got)
	}
}

// Retirar mas de lo guardado (la meta cambio desde otro dispositivo) tiene su
// codigo: no es una falla ni una billetera sin saldo.
func TestAhorro_RetirarMasDeLoGuardadoTieneSuCodigo(t *testing.T) {
	svc, pool, user := setupSavings(t)
	g := newGoal(t, svc, user)
	if _, _, err := svc.Deposit(context.Background(), user, g.ID, 10000, ""); err != nil {
		t.Fatalf("deposito: %v", err)
	}
	w0 := walletCRC(t, pool, user)

	r := pedirMovimiento(t, svc, user, g.ID, "withdraw", 20000)

	if r.estado != http.StatusUnprocessableEntity || r.codigo != "SAVINGS_EXCEEDS_SAVED" {
		t.Fatalf("respuesta = %d %s, se esperaba 422 SAVINGS_EXCEEDS_SAVED: %s", r.estado, r.codigo, r.cuerpo)
	}
	if got := guardadoEn(t, svc, user, g.ID); got != 10000 {
		t.Fatalf("guardado = %d, se esperaba 10000 (nada se movio)", got)
	}
	if got := walletCRC(t, pool, user); got != w0 {
		t.Fatalf("billetera = %d, se esperaba %d", got, w0)
	}
}

// Una meta de otra persona, una que no existe y un id que ni siquiera es un
// UUID son lo mismo para quien pide: esa meta no esta. El id mal formado
// llegaba a la base y volvia como error de sintaxis de Postgres.
func TestAhorro_UnaMetaQueNoEsTuyaONoExisteTieneSuCodigo(t *testing.T) {
	svc, pool, user := setupSavings(t)
	otra := testutil.SeedTestUser2(t, pool)
	ajena := newGoal(t, svc, otra)
	if _, _, err := svc.Deposit(context.Background(), otra, ajena.ID, 10000, ""); err != nil {
		t.Fatalf("deposito de la otra persona: %v", err)
	}
	w0 := walletCRC(t, pool, user)

	metas := map[string]string{
		"ajena":             ajena.ID,
		"que no existe":     uuid.NewString(),
		"sin forma de UUID": "no-es-una-meta",
	}
	for nombre, id := range metas {
		for _, ruta := range []string{"deposit", "withdraw"} {
			t.Run(nombre+" "+ruta, func(t *testing.T) {
				r := pedirMovimiento(t, svc, user, id, ruta, 1000)
				if r.estado != http.StatusNotFound || r.codigo != "SAVINGS_GOAL_NOT_FOUND" {
					t.Fatalf("respuesta = %d %s, se esperaba 404 SAVINGS_GOAL_NOT_FOUND: %s", r.estado, r.codigo, r.cuerpo)
				}
			})
		}
	}
	if got := walletCRC(t, pool, user); got != w0 {
		t.Fatalf("billetera = %d, se esperaba %d", got, w0)
	}
	if got := guardadoEn(t, svc, otra, ajena.ID); got != 10000 {
		t.Fatalf("la meta ajena quedo en %d, se esperaba 10000", got)
	}
}
