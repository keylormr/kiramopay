package marketplace_test

import (
	"context"
	"errors"
	"testing"

	"github.com/kiramopay/backend/internal/marketplace"
)

// El precio del viaje lo inventa el propio servicio y el chofer sale de una
// lista fija: cobrarlo debita la billetera de verdad contra un monto que nadie
// cotizo. Sin integracion con el socio, el cobro se rechaza. Se pasan repos
// nulos a proposito: si intentara cobrar, reventaria antes de devolver el error.
func TestConfirmRide_SinIntegracionNoCobra(t *testing.T) {
	svc := marketplace.NewService(nil, nil, nil, nil)
	_, err := svc.ConfirmRide(context.Background(), "u1", "r1")
	if !errors.Is(err, marketplace.ErrSinIntegracion) {
		t.Fatalf("ConfirmRide devolvio %v, se esperaba ErrSinIntegracion", err)
	}
}

func TestCreateFoodOrder_SinIntegracionNoCobra(t *testing.T) {
	svc := marketplace.NewService(nil, nil, nil, &marketplace.Options{CobrosActivos: false})
	_, err := svc.CreateFoodOrder(context.Background(), "u1", &marketplace.CreateFoodOrderRequest{
		PartnerCode:    "uber-eats",
		RestaurantName: "Soda La Esquina",
		Items:          []marketplace.FoodOrderItemReq{{Name: "Casado", Quantity: 1, Price: 350000}},
	})
	if !errors.Is(err, marketplace.ErrSinIntegracion) {
		t.Fatalf("CreateFoodOrder devolvio %v, se esperaba ErrSinIntegracion", err)
	}
}
