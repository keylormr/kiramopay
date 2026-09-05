package payment_test

import (
	"context"
	"errors"
	"testing"

	"github.com/kiramopay/backend/internal/payment"
)

// Sin convenio con la empresa o el operador, cobrar es debitar la billetera y
// dejar la plata en SYSTEM:EXTERNAL: nadie la recibe y no hay reverso. Estas
// pruebas fijan que la negativa ocurre ANTES de tocar nada — se pasan repos
// nulos a proposito: si el servicio intentara cobrar, reventaria.
func TestPayBill_SinConvenioNoCobra(t *testing.T) {
	svc := payment.NewService(nil, nil, nil)
	_, err := svc.PayBill(context.Background(), "u1", &payment.PayBillRequest{
		ProviderCode: "ICE", ClientID: "123", Amount: 5000,
	})
	if !errors.Is(err, payment.ErrSinConvenio) {
		t.Fatalf("PayBill devolvio %v, se esperaba ErrSinConvenio", err)
	}
}

func TestRecharge_SinConvenioNoCobra(t *testing.T) {
	svc := payment.NewService(nil, nil, &payment.Options{ConveniosActivos: false})
	_, err := svc.Recharge(context.Background(), "u1", &payment.RechargeRequest{
		Operator: "kolbi", Phone: "88880000", Amount: 5000,
	})
	if !errors.Is(err, payment.ErrSinConvenio) {
		t.Fatalf("Recharge devolvio %v, se esperaba ErrSinConvenio", err)
	}
}

// La negativa manda incluso sobre las validaciones de entrada: un monto
// invalido o un operador inexistente no deben adelantarse al motivo real.
func TestSinConvenio_MandaSobreLaValidacion(t *testing.T) {
	svc := payment.NewService(nil, nil, nil)
	if _, err := svc.Recharge(context.Background(), "u1", &payment.RechargeRequest{
		Operator: "inexistente", Phone: "88880000", Amount: -1,
	}); !errors.Is(err, payment.ErrSinConvenio) {
		t.Fatalf("devolvio %v, se esperaba ErrSinConvenio", err)
	}
}
