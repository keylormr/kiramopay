package payment_test

import (
	"context"
	"testing"

	"github.com/kiramopay/backend/internal/payment"
	"github.com/kiramopay/backend/internal/testutil"
)

// El catalogo lista lo MISMO que PayBill acepta: proveedores activos. Uno
// desactivado responde INVALID_PROVIDER al pagar, asi que no puede aparecer en
// la lista que la pantalla ofrece.
func TestListActiveProviders_SoloLosActivosEnOrden(t *testing.T) {
	pool := testutil.TestDB(t)
	ctx := context.Background()
	for _, p := range []struct {
		code, name, category string
		active               bool
	}{
		{"ice", "ICE — Electricidad", "electricity", true},
		{"aya", "AyA — Agua", "water", true},
		{"cnfl", "CNFL", "electricity", false},
		{"cabletica", "Cabletica — Internet", "internet", true},
	} {
		if _, err := pool.Exec(ctx,
			`INSERT INTO service_providers (code, name, category, is_active) VALUES ($1, $2, $3, $4)`,
			p.code, p.name, p.category, p.active); err != nil {
			t.Fatalf("seed %s: %v", p.code, err)
		}
	}

	got, err := payment.NewRepository(pool).ListActiveProviders(ctx)
	if err != nil {
		t.Fatalf("ListActiveProviders: %v", err)
	}

	var codigos []string
	for _, p := range got {
		codigos = append(codigos, p.Code)
	}
	// Por categoria y, dentro de ella, por nombre.
	quiero := []string{"ice", "cabletica", "aya"}
	if len(codigos) != len(quiero) {
		t.Fatalf("codigos = %v, quiero %v", codigos, quiero)
	}
	for i := range quiero {
		if codigos[i] != quiero[i] {
			t.Fatalf("codigos = %v, quiero %v", codigos, quiero)
		}
	}
	if got[0].Name != "ICE — Electricidad" || got[0].Category != "electricity" {
		t.Errorf("primer proveedor = %+v", got[0])
	}
}

func TestListActiveProviders_SinProveedoresEsListaVacia(t *testing.T) {
	pool := testutil.TestDB(t)

	got, err := payment.NewRepository(pool).ListActiveProviders(context.Background())
	if err != nil {
		t.Fatalf("ListActiveProviders: %v", err)
	}
	if got == nil || len(got) != 0 {
		t.Errorf("got = %#v, quiero lista vacia no nula", got)
	}
}
