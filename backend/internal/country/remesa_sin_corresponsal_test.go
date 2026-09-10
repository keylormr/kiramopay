package country

import (
	"context"
	"errors"
	"testing"
)

// La remesa se creaba con cumplimiento 'approved' y tres renglones despues se
// marcaba 'completed', sin tocar el libro, sin debitar y sin nadie recibiendo
// del otro lado: al remitente se le decia que su plata cruzo la frontera.
//
// El repositorio va en nil a proposito. Si el candado no fuera lo PRIMERO que
// corre, esta prueba explotaria al tocar la base — que es exactamente la
// garantia que hace falta: no se escribe una transferencia que nadie entrega.
func TestSinCorresponsalNoSeCreaLaRemesa(t *testing.T) {
	s := NewService(nil, &Options{CorresponsalActivo: false})

	_, err := s.SendCrossBorder(context.Background(), "u1", &CrossBorderRequest{
		ReceiverPhone: "88887777",
		ToCountry:     "PA",
		Amount:        50_000_00,
		Currency:      "CRC",
	})
	if !errors.Is(err, ErrSinCorresponsal) {
		t.Fatalf("error = %v, se esperaba ErrSinCorresponsal", err)
	}
}

// Sin Options el servicio queda cerrado. Es el valor por defecto correcto: un
// entorno que se olvide de configurarlo no debe empezar a prometer entregas.
func TestSinOpcionesElServicioQuedaCerrado(t *testing.T) {
	s := NewService(nil, nil)

	_, err := s.SendCrossBorder(context.Background(), "u1", &CrossBorderRequest{
		ReceiverPhone: "88887777", ToCountry: "PA", Amount: 1000, Currency: "CRC",
	})
	if !errors.Is(err, ErrSinCorresponsal) {
		t.Fatalf("error = %v, se esperaba ErrSinCorresponsal", err)
	}
}
