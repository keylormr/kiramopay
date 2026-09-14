package crypto

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"testing"

	"github.com/shopspring/decimal"
)

// Sin feed (prices nil) solo rigen las reglas fijas; la regla contra el precio
// de mercado se prueba en la integracion, con el feed de prueba.
func TestValidarAlerta_RechazaLoQueNoTieneSentido(t *testing.T) {
	s := &Service{}
	cien := decimal.NewFromInt(100)
	casos := []struct {
		nombre string
		alerta PriceAlertRecord
		quiere error
	}{
		{"activo que no existe", PriceAlertRecord{Asset: "NOEXISTE", TargetPrice: cien, Direction: "above"}, ErrAlertaActivoNoSoportado},
		{"activo vacio", PriceAlertRecord{Asset: "", TargetPrice: cien, Direction: "above"}, ErrAlertaActivoNoSoportado},
		{"direccion inventada", PriceAlertRecord{Asset: "BTC", TargetPrice: cien, Direction: "sideways"}, ErrAlertaDireccionInvalida},
		{"precio cero", PriceAlertRecord{Asset: "BTC", TargetPrice: decimal.Zero, Direction: "above"}, ErrAlertaPrecioFueraDeRango},
		{"precio negativo", PriceAlertRecord{Asset: "BTC", TargetPrice: decimal.NewFromInt(-100), Direction: "below"}, ErrAlertaPrecioFueraDeRango},
		{"precio absurdo", PriceAlertRecord{Asset: "BTC", TargetPrice: decimal.NewFromInt(999_999_999_999), Direction: "above"}, ErrAlertaPrecioFueraDeRango},
	}
	for _, c := range casos {
		alerta := c.alerta
		if err := s.validarAlerta(context.Background(), &alerta); !errors.Is(err, c.quiere) {
			t.Errorf("%s: err = %v, se esperaba %v", c.nombre, err, c.quiere)
		}
	}
}

func TestValidarAlerta_AceptaYNormalizaLoValido(t *testing.T) {
	s := &Service{}
	a := PriceAlertRecord{Asset: " btc ", TargetPrice: decimal.NewFromInt(90_000), Direction: "Above"}
	if err := s.validarAlerta(context.Background(), &a); err != nil {
		t.Fatalf("una alerta valida se rechazo: %v", err)
	}
	if a.Asset != "BTC" || a.Direction != "above" {
		t.Fatalf("no se normalizo: activo %q, direccion %q", a.Asset, a.Direction)
	}
}

func TestErrorDeAlerta_CodigosPropios(t *testing.T) {
	casos := []struct {
		err    error
		codigo string
	}{
		{fmt.Errorf("%w: %q", ErrAlertaActivoNoSoportado, "NOEXISTE"), "ALERT_UNSUPPORTED_ASSET"},
		{ErrAlertaDireccionInvalida, "ALERT_INVALID_DIRECTION"},
		{ErrAlertaPrecioFueraDeRango, "ALERT_PRICE_OUT_OF_RANGE"},
	}
	for _, c := range casos {
		codigo, estado, ok := errorDeAlerta(c.err)
		if !ok || codigo != c.codigo || estado != http.StatusBadRequest {
			t.Errorf("%v: codigo=%q estado=%d ok=%v, se esperaba %s/400", c.err, codigo, estado, ok, c.codigo)
		}
	}
	if _, _, ok := errorDeAlerta(errors.New("otra cosa")); ok {
		t.Fatal("un error ajeno a la validacion no debe tener codigo de alerta")
	}
}
