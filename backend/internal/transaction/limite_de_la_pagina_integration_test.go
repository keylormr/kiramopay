package transaction_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/kiramopay/backend/internal/middleware"
	"github.com/kiramopay/backend/internal/transaction"
)

// El tope de una pagina del historial es 100. Pedir mas devolvia 20, el valor
// por defecto, en vez del tope: `GET /transactions?limit=500` traia menos
// movimientos que `limit=100`. Lo encontro un recorrido contra el servidor
// real.
func TestListado_PedirMasQueElTopeDevuelveElTope(t *testing.T) {
	svc, pool, userID := setupTxServiceConPool(t)
	ahora := time.Now().UTC()
	for i := 0; i < 105; i++ {
		insertarMovimiento(t, pool, userID, "sinpe_send", "CRC", "completed", int64(1_000+i),
			ahora.Add(-time.Duration(i)*time.Minute))
	}

	casos := []struct{ pedido, quiere int }{
		{500, 100}, // mas que el tope: el tope
		{101, 100},
		{100, 100},
		{50, 50},
		{1, 1},
		{0, 20}, // sin pedido: el valor por defecto
		{-5, 20},
	}
	for _, c := range casos {
		res, err := svc.ListTransactions(context.Background(), userID, &transaction.ListTransactionsRequest{Limit: c.pedido})
		if err != nil {
			t.Fatalf("limit=%d: %v", c.pedido, err)
		}
		if len(res.Transactions) != c.quiere || res.Limit != c.quiere {
			t.Errorf("limit=%d: devolvio %d movimientos con limit %d, se esperaban %d",
				c.pedido, len(res.Transactions), res.Limit, c.quiere)
		}
		if res.Total != 105 {
			t.Errorf("limit=%d: total = %d, se esperaba 105", c.pedido, res.Total)
		}
	}
}

// Lo mismo por la ruta, que es por donde lo pide la pantalla.
func TestListado_PedirMasQueElTopePorLaRutaDevuelveElTope(t *testing.T) {
	svc, pool, userID := setupTxServiceConPool(t)
	ahora := time.Now().UTC()
	for i := 0; i < 105; i++ {
		insertarMovimiento(t, pool, userID, "sinpe_send", "CRC", "completed", int64(1_000+i),
			ahora.Add(-time.Duration(i)*time.Minute))
	}

	req := httptest.NewRequest(http.MethodGet, "http://localhost:8080/api/v1/transactions?limit=500", nil)
	req = req.WithContext(context.WithValue(req.Context(), middleware.UserIDKey, userID))
	rec := httptest.NewRecorder()
	transaction.NewHandler(svc).List(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body.String())
	}
	var env struct {
		Data struct {
			Transactions []json.RawMessage `json:"transactions"`
			Limit        int               `json:"limit"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("respuesta ilegible: %v", err)
	}
	if len(env.Data.Transactions) != 100 || env.Data.Limit != 100 {
		t.Errorf("limit=500 devolvio %d movimientos con limit %d, se esperaban 100",
			len(env.Data.Transactions), env.Data.Limit)
	}
}
