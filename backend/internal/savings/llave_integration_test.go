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
	"github.com/kiramopay/backend/internal/middleware"
	"github.com/kiramopay/backend/internal/savings"
)

type movimientoLeido struct {
	estado   int
	codigo   string
	guardado int64
	repetido bool
}

// mover deposita o retira por la ruta real, con la llave en la cabecera.
func mover(t *testing.T, svc *savings.Service, user, metaID, ruta string, monto int64, llave string) movimientoLeido {
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
	req.Header.Set("Idempotency-Key", llave)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	var sobre struct {
		Data struct {
			SavedMinor int64 `json:"saved_minor"`
			Replayed   bool  `json:"replayed"`
		} `json:"data"`
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &sobre); err != nil {
		t.Fatalf("respuesta ilegible %d: %v: %s", rec.Code, err, rec.Body.String())
	}
	return movimientoLeido{rec.Code, sobre.Error.Code, sobre.Data.SavedMinor, sobre.Data.Replayed}
}

// Depositar todo el saldo y perder la respuesta: el reintento con la misma
// llave leia el saldo antes que la llave, veia la billetera en cero y
// respondia "insufficient balance" por un deposito que SI se habia hecho. La
// pantalla decia "no se pudo depositar, tu dinero sigue en la billetera".
func TestAhorro_ElReintentoDelDepositoQueSeLlevoTodoElSaldoNoEsSinSaldo(t *testing.T) {
	svc, pool, user := setupSavings(t)
	g := newGoal(t, svc, user)
	todo := walletCRC(t, pool, user)
	if todo <= 0 {
		t.Fatalf("la billetera de prueba nace en %d", todo)
	}
	s0 := savingsHeldCRC(t, pool)

	if r := mover(t, svc, user, g.ID, "deposit", todo, "deposito-todo-1"); r.estado != http.StatusOK || r.guardado != todo {
		t.Fatalf("deposito = %d %s (guardado %d), se esperaba 200 con %d", r.estado, r.codigo, r.guardado, todo)
	}

	r := mover(t, svc, user, g.ID, "deposit", todo, "deposito-todo-1")
	if r.estado != http.StatusOK || !r.repetido || r.guardado != todo {
		t.Fatalf("reintento = %d %s (guardado %d, repetido %v), se esperaba 200 repetido con %d",
			r.estado, r.codigo, r.guardado, r.repetido, todo)
	}
	if got := walletCRC(t, pool, user); got != 0 {
		t.Fatalf("billetera = %d, se esperaba 0 (un solo debito)", got)
	}
	if got := savingsHeldCRC(t, pool); got != s0+todo {
		t.Fatalf("ahorro = %d, se esperaba %d", got, s0+todo)
	}
}

// La repeticion se marca. Sin la marca, la pantalla no puede decir que el
// movimiento ya estaba hecho ni soltar la llave: un segundo deposito identico,
// hecho a proposito el mismo dia, viajaba con la llave del primero y el
// servidor lo devolvia como hecho sin mover nada.
func TestAhorro_LaRepeticionSeMarca(t *testing.T) {
	svc, pool, user := setupSavings(t)
	g := newGoal(t, svc, user)
	w0 := walletCRC(t, pool, user)

	casos := []struct {
		ruta     string
		monto    int64
		llave    string
		guardado int64
	}{
		{"deposit", 1000, "dep-1", 1000},
		{"withdraw", 400, "ret-1", 600},
	}
	for _, c := range casos {
		primero := mover(t, svc, user, g.ID, c.ruta, c.monto, c.llave)
		if primero.estado != http.StatusOK || primero.repetido || primero.guardado != c.guardado {
			t.Fatalf("%s = %d %s (guardado %d, repetido %v), se esperaba 200 sin marca con %d",
				c.ruta, primero.estado, primero.codigo, primero.guardado, primero.repetido, c.guardado)
		}
		otra := mover(t, svc, user, g.ID, c.ruta, c.monto, c.llave)
		if otra.estado != http.StatusOK || !otra.repetido || otra.guardado != c.guardado {
			t.Fatalf("%s otra vez = %d %s (guardado %d, repetido %v), se esperaba 200 repetido con %d",
				c.ruta, otra.estado, otra.codigo, otra.guardado, otra.repetido, c.guardado)
		}
	}
	if got := walletCRC(t, pool, user); got != w0-600 {
		t.Fatalf("billetera = %d, se esperaba %d", got, w0-600)
	}
}

// El reintento de un deposito que despues se retiro sigue siendo la
// repeticion de aquel deposito: no vuelve a mover nada y lo dice.
func TestAhorro_ElReintentoDeUnDepositoYaRetiradoNoMueveNada(t *testing.T) {
	svc, pool, user := setupSavings(t)
	g := newGoal(t, svc, user)
	w0 := walletCRC(t, pool, user)

	if r := mover(t, svc, user, g.ID, "deposit", 5000, "dep-luego-retirado"); r.estado != http.StatusOK {
		t.Fatalf("deposito = %d %s", r.estado, r.codigo)
	}
	if r := mover(t, svc, user, g.ID, "withdraw", 5000, "ret-todo"); r.estado != http.StatusOK || r.guardado != 0 {
		t.Fatalf("retiro = %d %s (guardado %d)", r.estado, r.codigo, r.guardado)
	}

	r := mover(t, svc, user, g.ID, "deposit", 5000, "dep-luego-retirado")
	if r.estado != http.StatusOK || !r.repetido || r.guardado != 0 {
		t.Fatalf("reintento = %d %s (guardado %d, repetido %v), se esperaba 200 repetido con 0",
			r.estado, r.codigo, r.guardado, r.repetido)
	}
	if got := walletCRC(t, pool, user); got != w0 {
		t.Fatalf("billetera = %d, se esperaba %d", got, w0)
	}
}
