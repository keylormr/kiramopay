package qrpayment

import "testing"

// El aviso de un cobro escribe el monto como la app: simbolo y miles con coma.
// Antes llegaba "CRC 12500.00".
func TestElAvisoDelCobroEscribeElMontoComoLaApp(t *testing.T) {
	casos := []struct {
		p    QRPaymentRecord
		want string
	}{
		{QRPaymentRecord{Amount: 1_250_000, Currency: "CRC", Note: "Cafe"}, "₡12,500.00 — Cafe"},
		{QRPaymentRecord{Amount: 2_500, Currency: "USD"}, "$25.00"},
	}
	for _, c := range casos {
		if got := detalleDelCobro(&c.p); got != c.want {
			t.Errorf("detalleDelCobro = %q, se esperaba %q", got, c.want)
		}
	}
}
