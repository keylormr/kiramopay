package savings

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/kiramopay/backend/internal/middleware"
)

// moverPorLaRuta deposita o retira por la ruta real, con el cuerpo tal cual.
func moverPorLaRuta(t *testing.T, h *Handler, ruta, metaID, cuerpo string) (int, sobreDeError, string) {
	t.Helper()
	r := chi.NewRouter()
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			next.ServeHTTP(w, req.WithContext(context.WithValue(req.Context(), middleware.UserIDKey,
				"00000000-0000-0000-0000-000000000001")))
		})
	})
	r.Post("/savings/goals/{id}/deposit", h.Deposit)
	r.Post("/savings/goals/{id}/withdraw", h.Withdraw)

	req := httptest.NewRequest(http.MethodPost, "/savings/goals/"+metaID+"/"+ruta, strings.NewReader(cuerpo))
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	var sobre sobreDeError
	if err := json.Unmarshal(rec.Body.Bytes(), &sobre); err != nil {
		t.Fatalf("respuesta ilegible %d: %v: %s", rec.Code, err, rec.Body.String())
	}
	return rec.Code, sobre, rec.Body.String()
}

// Depositar o retirar cero o un monto negativo respondia 400 SAVINGS_FAILED
// "amount must be positive", el mismo codigo que una billetera sin saldo o una
// falla de la base: la pantalla no podia decir que corregir. El monto se
// revisa antes de tocar la base: la prueba no la necesita.
func TestMoverUnMontoQueNoEsPositivoTieneSuCodigo(t *testing.T) {
	h := NewHandler(NewService(nil, nil, nil))
	meta := "00000000-0000-0000-0000-0000000000aa"

	casos := []struct {
		ruta   string
		cuerpo string
	}{
		{"deposit", `{"amount_minor":0}`},
		{"deposit", `{"amount_minor":-5000}`},
		{"withdraw", `{"amount_minor":0}`},
		{"withdraw", `{"amount_minor":-5000}`},
	}
	for _, c := range casos {
		t.Run(c.ruta+" "+c.cuerpo, func(t *testing.T) {
			estado, sobre, cuerpo := moverPorLaRuta(t, h, c.ruta, meta, c.cuerpo)
			if estado != http.StatusBadRequest || sobre.Error.Code != "SAVINGS_INVALID_AMOUNT" {
				t.Fatalf("respuesta = %d %s, se esperaba 400 SAVINGS_INVALID_AMOUNT: %s",
					estado, sobre.Error.Code, cuerpo)
			}
		})
	}
}

// Si la base falla, el movimiento no fue rechazado por nada del pedido: es un
// 500, y el texto del driver se queda en el log. Como 400, la pantalla lo
// tomaba por un rechazo y decia "tu dinero sigue en la billetera" sin saberlo:
// una falla despues del commit tambien cae aqui, y ahi el dinero ya se movio.
func TestMoverConLaBaseCaidaEsUn500SinElDetalle(t *testing.T) {
	pool, err := pgxpool.New(context.Background(), "postgres://ahorro:ahorro@127.0.0.1:1/ahorro?sslmode=disable")
	if err != nil {
		t.Fatalf("armar el pool: %v", err)
	}
	pool.Close()
	h := NewHandler(NewService(NewRepository(pool), nil, nil))
	meta := "00000000-0000-0000-0000-0000000000aa"

	for _, ruta := range []string{"deposit", "withdraw"} {
		t.Run(ruta, func(t *testing.T) {
			estado, sobre, cuerpo := moverPorLaRuta(t, h, ruta, meta, `{"amount_minor":1000}`)
			if estado != http.StatusInternalServerError || sobre.Error.Code != "SAVINGS_FAILED" {
				t.Fatalf("respuesta = %d %s, se esperaba 500 SAVINGS_FAILED: %s", estado, sobre.Error.Code, cuerpo)
			}
			for _, detalle := range []string{"acquire conn", "closed pool", "127.0.0.1"} {
				if strings.Contains(cuerpo, detalle) {
					t.Errorf("la respuesta trae el detalle interno %q: %s", detalle, cuerpo)
				}
			}
		})
	}
}
