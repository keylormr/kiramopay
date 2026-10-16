package splitpay_test

import (
	"context"
	"testing"

	"github.com/kiramopay/backend/internal/splitpay"
)

// La cuota de quien crea la division nacia sin nombre ni telefono
// (nuevaCuota(creatorID, "", "", ...)): en el detalle, quien tenia que pagar
// veia esa fila en blanco y no sabia a quien le pagaba, y su movimiento salia
// sin contraparte. Las divisiones ya guardadas tienen esa fila igual, asi que el
// nombre se resuelve al leer, desde la cuenta, y no solo al crear.

func TestDivision_LaCuotaDeQuienLaCreoLlevaSuNombre(t *testing.T) {
	_, svc, creador, segundo, tercera := montar(t)
	ctx := context.Background()

	grupo, _, err := svc.CreateSplit(ctx, creador, &splitpay.CreateSplitRequest{
		Title: "Almuerzo", TotalAmount: 30_000, Currency: "CRC", SplitType: "equal",
		Participants: []splitpay.ParticipantReq{
			{UserPhone: telefonoSegundo, UserName: "Ana"},
			{UserPhone: telefonoTercera},
		},
	})
	if err != nil {
		t.Fatalf("crear la division: %v", err)
	}

	_, cuotas, err := svc.GetSplit(ctx, grupo.ID)
	if err != nil {
		t.Fatalf("leer la division: %v", err)
	}
	// testutil.SeedTestUser: Test User.
	if c := cuotaDe(t, cuotas, creador); c.UserName != "Test User" {
		t.Fatalf("la cuota de quien creo la division se llama %q, se esperaba el nombre de su cuenta", c.UserName)
	}
	// Las demas no cambian: el nombre con que la anoto quien creo la division
	// y, sin el, el de la cuenta (testutil.SeedTestUser3).
	if c := cuotaDe(t, cuotas, segundo); c.UserName != "Ana" {
		t.Fatalf("la cuota anotada como Ana se llama %q", c.UserName)
	}
	if c := cuotaDe(t, cuotas, tercera); c.UserName != "Segunda Pagadora" {
		t.Fatalf("la cuota sin nombre anotado se llama %q", c.UserName)
	}
	// Hasta ahora salia primera porque su nombre vacio ordenaba antes que
	// cualquiera. Con nombre sigue primera: es a quien se le paga.
	if cuotas[0].UserID != creador {
		t.Fatalf("la primera cuota es de %s, se esperaba la de quien creo la division", cuotas[0].UserID)
	}
}

func TestDivision_QuienPagaVeEnSuMovimientoAQuienLePago(t *testing.T) {
	pool, svc, creador, segundo, _ := montar(t)
	ctx := context.Background()

	grupo, _, err := svc.CreateSplit(ctx, creador, &splitpay.CreateSplitRequest{
		Title: "Almuerzo", TotalAmount: 20_000, Currency: "CRC", SplitType: "equal",
		Participants: []splitpay.ParticipantReq{{UserPhone: telefonoSegundo, UserName: "Ana"}},
	})
	if err != nil {
		t.Fatalf("crear la division: %v", err)
	}
	if err := svc.PayShare(ctx, segundo, grupo.ID); err != nil {
		t.Fatalf("pagar la cuota: %v", err)
	}

	var contraparte string
	if err := pool.QueryRow(ctx,
		`SELECT COALESCE(counterparty_name, '') FROM transactions
		  WHERE user_id = $1::uuid AND type = 'p2p_send'
		  ORDER BY created_at DESC LIMIT 1`, segundo).Scan(&contraparte); err != nil {
		t.Fatalf("leer el movimiento de quien pago: %v", err)
	}
	if contraparte != "Test User" {
		t.Fatalf("el movimiento de quien pago dice %q como contraparte, se esperaba quien creo la division", contraparte)
	}
}
