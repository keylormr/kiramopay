package crypto_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/kiramopay/backend/internal/crypto"
	"github.com/kiramopay/backend/internal/middleware"
)

// La billetera propia (ver billetera_propia.go): el servidor solo dice si la
// pantalla la ofrece. En espera la ven las cuentas de demostracion y nadie mas,
// y esperar no toca la pausa de compras, que es otra decision.
func TestBilleteraPropia_LaPantallaSabeSiLaVe(t *testing.T) {
	m := montarVenta(t)
	disponibilidad := func(svc *crypto.Service) crypto.Disponibilidad {
		t.Helper()
		req := httptest.NewRequest(http.MethodGet, "http://localhost:8080/api/v1/crypto/availability", nil)
		req = req.WithContext(context.WithValue(req.Context(), middleware.UserIDKey, m.userID))
		rec := httptest.NewRecorder()
		crypto.NewHandler(svc).GetAvailability(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("salio %d: %s", rec.Code, rec.Body.String())
		}
		var cuerpo struct {
			Data crypto.Disponibilidad `json:"data"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &cuerpo); err != nil {
			t.Fatalf("respuesta: %v", err)
		}
		return cuerpo.Data
	}

	if !disponibilidad(m.svc).SelfCustodyActive {
		t.Error("sin espera deberia verla")
	}

	enEspera := servicioDeVentaCon(t, m.pool, m.urlPrecios, &crypto.Opciones{BilleteraPropiaEnEspera: true})
	d := disponibilidad(enEspera)
	if d.SelfCustodyActive {
		t.Error("en espera una cuenta normal no deberia verla")
	}
	if !d.PurchasesActive {
		t.Error("esperar la billetera propia no deberia pausar las compras")
	}

	m.marcarDemo(t)
	if !disponibilidad(enEspera).SelfCustodyActive {
		t.Error("la cuenta de demostracion deberia verla")
	}
}
