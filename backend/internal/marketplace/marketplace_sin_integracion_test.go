package marketplace_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
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

// Pedir un viaje no cobra, pero el precio y el chofer son inventados y sin
// socio el viaje nunca se podria confirmar: tampoco se pide. Repos nulos a
// proposito, igual que arriba: si llegara a la base, reventaria.
func TestCreateRideRequest_SinIntegracionNoSePide(t *testing.T) {
	svc := marketplace.NewService(nil, nil, nil, &marketplace.Options{CobrosActivos: false})
	_, err := svc.CreateRideRequest(context.Background(), "u1", &marketplace.CreateRideRequest{
		PartnerCode: "uber", Pickup: "San Jose", Destination: "Heredia",
	})
	if !errors.Is(err, marketplace.ErrSinIntegracion) {
		t.Fatalf("CreateRideRequest devolvio %v, se esperaba ErrSinIntegracion", err)
	}
}

// Conectar un socio sin integracion anunciaria un enlace que no existe.
func TestConnectPartner_SinIntegracionNoConecta(t *testing.T) {
	svc := marketplace.NewService(nil, nil, nil, nil)
	if err := svc.ConnectPartner(context.Background(), "u1", "uber"); !errors.Is(err, marketplace.ErrSinIntegracion) {
		t.Fatalf("ConnectPartner devolvio %v, se esperaba ErrSinIntegracion", err)
	}
}

// La pantalla pregunta antes de ofrecer el modulo; la respuesta es la misma
// bandera que el cobro.
func TestDisponible_EsLaBanderaDelCobro(t *testing.T) {
	if marketplace.NewService(nil, nil, nil, nil).Disponible() {
		t.Error("sin opciones el modulo se ofrece; sin socio no debe")
	}
	if !marketplace.NewService(nil, nil, nil, &marketplace.Options{CobrosActivos: true}).Disponible() {
		t.Error("con el cobro activo el modulo no se ofrece")
	}
}

func TestAvailability_RespondeLaBandera(t *testing.T) {
	for _, activo := range []bool{false, true} {
		h := marketplace.NewHandler(marketplace.NewService(nil, nil, nil, &marketplace.Options{CobrosActivos: activo}))
		rec := httptest.NewRecorder()
		h.Availability(rec, httptest.NewRequest(http.MethodGet, "/api/v1/marketplace/availability", nil))
		if rec.Code != http.StatusOK {
			t.Fatalf("codigo %d", rec.Code)
		}
		var sobre struct {
			Data struct {
				Active bool `json:"active"`
			} `json:"data"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &sobre); err != nil {
			t.Fatalf("respuesta no es JSON: %v", err)
		}
		if sobre.Data.Active != activo {
			t.Errorf("active = %v, la bandera es %v", sobre.Data.Active, activo)
		}
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
