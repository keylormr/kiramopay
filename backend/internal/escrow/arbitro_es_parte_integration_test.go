package escrow_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/kiramopay/backend/internal/escrow"
)

// Desde el PR 295 administra una cuenta personal, que compra y vende con
// escrow. Quien arbitra una disputa no puede ser una de las partes: el
// comprador se reembolsaria y el vendedor se liberaria el pago. La ruta
// responde 403 ADMIN_IS_AFFECTED_PARTY, el acuerdo sigue en disputa y la plata
// no se mueve.
func TestEscrow_UnaParteNoArbitraSuPropiaDisputa(t *testing.T) {
	pool, svc, buyer, seller := setup(t)
	ctx := context.Background()
	h := escrow.NewHandler(svc)

	a, err := svc.Create(ctx, buyer, &escrow.CreateRequest{
		SellerID: seller, AmountMinor: 50_000, Currency: "CRC", Description: "phone",
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if _, err := svc.Fund(ctx, buyer, a.ID); err != nil {
		t.Fatalf("Fund: %v", err)
	}
	if _, err := svc.Dispute(ctx, buyer, a.ID, "item not received"); err != nil {
		t.Fatalf("Dispute: %v", err)
	}
	comprador0, vendedor0, custodia0 := walletCRC(t, pool, buyer), walletCRC(t, pool, seller), escrowAccountBalance(t, pool)

	casos := []struct{ quien, parte, veredicto string }{
		{buyer, "el comprador", "refunded"},
		{buyer, "el comprador", "released"},
		{seller, "el vendedor", "released"},
		{seller, "el vendedor", "refunded"},
	}
	for _, c := range casos {
		rec := httptest.NewRecorder()
		h.Resolve(rec, reqWithUser(http.MethodPost, "/api/v1/admin/escrow/"+a.ID+"/resolve",
			`{"outcome":"`+c.veredicto+`"}`, c.quien, a.ID))
		var sobre struct {
			Error struct {
				Code string `json:"code"`
			} `json:"error"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &sobre)
		if rec.Code != http.StatusForbidden || sobre.Error.Code != "ADMIN_IS_AFFECTED_PARTY" {
			t.Errorf("%s resolvio %s: %d %s, se esperaba 403 ADMIN_IS_AFFECTED_PARTY",
				c.parte, c.veredicto, rec.Code, rec.Body.String())
		}
	}

	got, err := svc.Get(ctx, buyer, a.ID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got.Status != escrow.StatusDisputed {
		t.Fatalf("el acuerdo quedo %s: una parte arbitro su propia disputa", got.Status)
	}
	if walletCRC(t, pool, buyer) != comprador0 || walletCRC(t, pool, seller) != vendedor0 || escrowAccountBalance(t, pool) != custodia0 {
		t.Fatal("se movio plata con el arbitraje de una parte")
	}

	// Un tercero si la resuelve.
	if _, err := svc.Resolve(ctx, "admin-id", a.ID, escrow.StatusRefunded); err != nil {
		t.Fatalf("un tercero: %v", err)
	}
}
