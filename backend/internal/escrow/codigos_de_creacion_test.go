package escrow

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

// Crear un acuerdo con el propio telefono, con monto cero o sin descripcion
// respondia lo mismo: 400 INVALID_REQUEST "invalid request". La pantalla no
// podia decir que estaba mal y mostraba ese ingles tal cual.
func TestCrear_CadaRechazoDeFormaTieneSuPropioError(t *testing.T) {
	svc := NewService(nil, nil, nil) // el repo no se alcanza con datos invalidos
	comprador := "00000000-0000-0000-0000-000000000001"
	vendedor := "00000000-0000-0000-0000-000000000002"

	casos := []struct {
		nombre string
		req    *CreateRequest
		quiere error
	}{
		{"monto cero", &CreateRequest{SellerID: vendedor, AmountMinor: 0, Description: "x"}, ErrMontoInvalido},
		{"monto negativo", &CreateRequest{SellerID: vendedor, AmountMinor: -5, Description: "x"}, ErrMontoInvalido},
		{"descripcion en blanco", &CreateRequest{SellerID: vendedor, AmountMinor: 100, Description: "  "}, ErrDescripcionVacia},
		{"con uno mismo", &CreateRequest{SellerID: comprador, AmountMinor: 100, Description: "x"}, ErrContraparteEsUnoMismo},
	}
	for _, c := range casos {
		_, err := svc.Create(context.Background(), comprador, c.req)
		if !errors.Is(err, c.quiere) {
			t.Errorf("%s: err = %v, se esperaba %v", c.nombre, err, c.quiere)
		}
		// Quien ya comprobaba ErrInvalidRequest no se rompe.
		if !errors.Is(err, ErrInvalidRequest) {
			t.Errorf("%s: %v ya no es ErrInvalidRequest", c.nombre, err)
		}
	}
}

func TestEscribirError_CodigosDeCrearAcuerdo(t *testing.T) {
	casos := []struct {
		err    error
		estado int
		codigo string
	}{
		{ErrContraparteEsUnoMismo, http.StatusBadRequest, "ESCROW_SELF"},
		{fmt.Errorf("envuelto: %w", ErrContraparteEsUnoMismo), http.StatusBadRequest, "ESCROW_SELF"},
		{ErrMontoInvalido, http.StatusBadRequest, "ESCROW_INVALID_AMOUNT"},
		{ErrDescripcionVacia, http.StatusBadRequest, "ESCROW_DESCRIPTION_REQUIRED"},
		// Lo que no tiene codigo propio sigue saliendo como antes.
		{ErrInvalidRequest, http.StatusBadRequest, "INVALID_REQUEST"},
		{ErrVendedorSinCuenta, http.StatusUnprocessableEntity, "ESCROW_SELLER_NOT_FOUND"},
	}
	h := &Handler{}
	for _, c := range casos {
		rec := httptest.NewRecorder()
		h.writeError(rec, c.err)
		var sobre struct {
			Error struct {
				Code string `json:"code"`
			} `json:"error"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &sobre); err != nil {
			t.Fatalf("%v: respuesta ilegible: %v", c.err, err)
		}
		if rec.Code != c.estado || sobre.Error.Code != c.codigo {
			t.Errorf("%v: %d %s, se esperaba %d %s", c.err, rec.Code, sobre.Error.Code, c.estado, c.codigo)
		}
	}
}
