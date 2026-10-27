package qrpayment_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/kiramopay/backend/internal/qrpayment"
)

// La categoria del comercio era un texto libre: el servidor guardaba cualquier
// cosa ("other", "", "Restaurant") y la pantalla armaba la clave de traduccion
// con ella, asi que un comercio con una categoria que nadie tradujo mostraba la
// clave cruda ("merchant_cat_other") en el panel de verificacion. El registro
// rechaza lo que no sea una de las cinco categorias que ofrece la app, con un
// codigo propio, ANTES de tocar la base.

func cuerpoDeRegistro(categoria string) string {
	return `{"name":"Soda Tica","description":"","category":"` + categoria + `",` +
		`"cedula":"3-101-123","cedula_type":"juridica","legal_name":"Soda Tica SA"}`
}

// Con la base caida, un rechazo de la categoria sale ANTES de la base (400
// INVALID_CATEGORY); si la categoria llegara a la base, la caida saldria como
// otro codigo. Asi la prueba corre sin base de pruebas.
func TestRegisterMerchant_UnaCategoriaDesconocidaSeRechazaAntesDeLaBase(t *testing.T) {
	h := qrpayment.NewHandler(servicioSinBase(t))

	for _, categoria := range []string{"other", "", "Restaurant", "restaurant ", "bar", "<script>"} {
		t.Run("categoria "+categoria, func(t *testing.T) {
			rec := httptest.NewRecorder()
			h.RegisterMerchant(rec, peticion(http.MethodPost, "/api/v1/qr/merchant",
				cuerpoDeRegistro(categoria), "user-1", ""))
			codigo, mensaje := errorDeLaRespuesta(t, rec)
			if rec.Code != http.StatusBadRequest || codigo != "INVALID_CATEGORY" {
				t.Fatalf("= %d %s (%q), se esperaba 400 INVALID_CATEGORY", rec.Code, codigo, mensaje)
			}
		})
	}
}

// Las cinco categorias que ofrece la app no se rechazan por categoria. Con la
// base caida el registro falla, pero no con el codigo de la categoria.
func TestRegisterMerchant_LasCincoCategoriasDeLaAppPasanLaValidacion(t *testing.T) {
	h := qrpayment.NewHandler(servicioSinBase(t))

	for _, categoria := range []string{"restaurant", "retail", "services", "food_truck", "market"} {
		t.Run(categoria, func(t *testing.T) {
			rec := httptest.NewRecorder()
			h.RegisterMerchant(rec, peticion(http.MethodPost, "/api/v1/qr/merchant",
				cuerpoDeRegistro(categoria), "user-1", ""))
			codigo, _ := errorDeLaRespuesta(t, rec)
			if codigo == "INVALID_CATEGORY" {
				t.Fatalf("la categoria %q de la app se rechazo como invalida", categoria)
			}
		})
	}
}
