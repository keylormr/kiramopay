package escrow_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/kiramopay/backend/internal/escrow"
)

// La respuesta de la lista, del detalle y de cada accion lleva el nombre de la
// otra parte. El acuerdo guardado y los avisos a los webhooks no lo llevan.

func nombreEnLaRespuesta(t *testing.T, rec *httptest.ResponseRecorder, lista bool) string {
	t.Helper()
	if rec.Code != http.StatusOK && rec.Code != http.StatusCreated {
		t.Fatalf("codigo %d: %s", rec.Code, rec.Body.String())
	}
	var env struct {
		Data json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("no es JSON: %s", rec.Body.String())
	}
	if lista {
		var items []struct {
			CounterpartyName string `json:"counterparty_name"`
		}
		if err := json.Unmarshal(env.Data, &items); err != nil || len(items) != 1 {
			t.Fatalf("lista inesperada (%v): %s", err, rec.Body.String())
		}
		return items[0].CounterpartyName
	}
	var one struct {
		CounterpartyName string `json:"counterparty_name"`
	}
	if err := json.Unmarshal(env.Data, &one); err != nil {
		t.Fatalf("detalle inesperado: %s", rec.Body.String())
	}
	return one.CounterpartyName
}

func TestRespuestas_LlevanElNombreDeLaOtraParte(t *testing.T) {
	_, svc, comprador, vendedor := conBuscador(t) // "Test User" compra, "Admin User" vende
	h := escrow.NewHandler(svc)
	ctx := context.Background()

	a, err := svc.Create(ctx, comprador, &escrow.CreateRequest{
		SellerPhone: telefonoVendedor, AmountMinor: 150_000, Currency: "CRC", Description: "bicicleta",
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	t.Run("detalle", func(t *testing.T) {
		rec := httptest.NewRecorder()
		h.Get(rec, reqWithUser(http.MethodGet, "/escrow/"+a.ID, "", comprador, a.ID))
		if got := nombreEnLaRespuesta(t, rec, false); got != "Admin User" {
			t.Fatalf("el comprador ve %q, se esperaba el nombre del vendedor", got)
		}

		rec = httptest.NewRecorder()
		h.Get(rec, reqWithUser(http.MethodGet, "/escrow/"+a.ID, "", vendedor, a.ID))
		if got := nombreEnLaRespuesta(t, rec, false); got != "Test User" {
			t.Fatalf("el vendedor ve %q, se esperaba el nombre del comprador", got)
		}
	})

	t.Run("lista", func(t *testing.T) {
		rec := httptest.NewRecorder()
		h.List(rec, reqWithUser(http.MethodGet, "/escrow", "", comprador, ""))
		if got := nombreEnLaRespuesta(t, rec, true); got != "Admin User" {
			t.Fatalf("la lista del comprador trae %q", got)
		}
	})

	t.Run("una accion tambien", func(t *testing.T) {
		rec := httptest.NewRecorder()
		h.Fund(rec, reqWithUser(http.MethodPost, "/escrow/"+a.ID+"/fund", "", comprador, a.ID))
		if got := nombreEnLaRespuesta(t, rec, false); got != "Admin User" {
			t.Fatalf("al fondear, la respuesta trae %q", got)
		}
	})

	t.Run("el acuerdo guardado no lleva el nombre", func(t *testing.T) {
		guardado, err := svc.Get(ctx, comprador, a.ID)
		if err != nil {
			t.Fatalf("Get: %v", err)
		}
		if guardado.CounterpartyName != "" {
			t.Fatalf("el servicio devolvio el nombre en el acuerdo (%q): iria a los webhooks", guardado.CounterpartyName)
		}
	})
}
