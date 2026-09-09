package marketplace_test

import (
	"context"
	"testing"

	"github.com/kiramopay/backend/internal/marketplace"
)

// El agujero: PATCH /marketplace/rides/{id} aceptaba 'confirmed' entre sus
// estados validos. Un viaje quedaba confirmado GRATIS, y ConfirmRide —que es el
// paso que cobra— despues lo rechazaba con "ride already confirmed". Ese viaje
// ya no se podia cobrar nunca mas.
func TestPatchNoPuedeConfirmarUnViaje(t *testing.T) {
	svc, pool, user := setupMarketplace(t)
	ctx := context.Background()

	ride, err := svc.CreateRideRequest(ctx, user, &marketplace.CreateRideRequest{
		PartnerCode: "uber", Pickup: "A", Destination: "B",
	})
	if err != nil {
		t.Fatalf("CreateRideRequest: %v", err)
	}

	if err := svc.UpdateRideStatus(ctx, ride.ID, "confirmed"); err == nil {
		t.Fatal("el PATCH confirmo el viaje sin cobrarlo")
	}

	// Y lo que importa de verdad: el viaje sigue siendo cobrable.
	saldo0 := walletCRC(t, pool, user)
	if _, err := svc.ConfirmRide(ctx, user, ride.ID); err != nil {
		t.Fatalf("ConfirmRide despues del PATCH: %v", err)
	}
	if got, want := walletCRC(t, pool, user), saldo0-ride.EstimatedPrice; got != want {
		t.Fatalf("saldo = %d, se esperaba %d", got, want)
	}
}

// Llevar el viaje a 'in_progress' o 'completed' desde 'searching' es el mismo
// agujero con otro nombre: lo saca del estado en que se puede cobrar.
func TestPatchNoAvanzaUnViajeSinPagar(t *testing.T) {
	svc, _, user := setupMarketplace(t)
	ctx := context.Background()

	ride, err := svc.CreateRideRequest(ctx, user, &marketplace.CreateRideRequest{
		PartnerCode: "uber", Pickup: "A", Destination: "B",
	})
	if err != nil {
		t.Fatalf("CreateRideRequest: %v", err)
	}

	for _, estado := range []string{"in_progress", "completed", "arriving"} {
		if err := svc.UpdateRideStatus(ctx, ride.ID, estado); err == nil {
			t.Errorf("el PATCH movio a %q un viaje que no ha pagado", estado)
		}
	}
}

// Cancelar sigue permitido desde 'searching': no se cobro nada y no hay nada
// que entregar.
func TestPatchPuedeCancelarUnViajeQueBusca(t *testing.T) {
	svc, _, user := setupMarketplace(t)
	ctx := context.Background()

	ride, err := svc.CreateRideRequest(ctx, user, &marketplace.CreateRideRequest{
		PartnerCode: "uber", Pickup: "A", Destination: "B",
	})
	if err != nil {
		t.Fatalf("CreateRideRequest: %v", err)
	}
	if err := svc.UpdateRideStatus(ctx, ride.ID, "cancelled"); err != nil {
		t.Fatalf("cancelar un viaje que busca chofer: %v", err)
	}
}

// Una vez pagado, el PATCH hace lo que siempre hizo.
func TestPatchAvanzaUnViajeYaPagado(t *testing.T) {
	svc, _, user := setupMarketplace(t)
	ctx := context.Background()

	ride, err := svc.CreateRideRequest(ctx, user, &marketplace.CreateRideRequest{
		PartnerCode: "uber", Pickup: "A", Destination: "B",
	})
	if err != nil {
		t.Fatalf("CreateRideRequest: %v", err)
	}
	if _, err := svc.ConfirmRide(ctx, user, ride.ID); err != nil {
		t.Fatalf("ConfirmRide: %v", err)
	}
	if err := svc.UpdateRideStatus(ctx, ride.ID, "in_progress"); err != nil {
		t.Fatalf("avanzar un viaje pagado: %v", err)
	}
}
