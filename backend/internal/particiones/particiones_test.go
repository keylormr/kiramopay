package particiones

import (
	"testing"
	"time"
)

// DiasDeMargen es lo que se publica en /health y lo que alguien va a mirar para
// decidir si hay que actuar. Un -1 tiene que ser distinguible de un cero: uno
// dice "no lo se", el otro dice "se acaba hoy".
func TestDiasDeMargen(t *testing.T) {
	ahora := time.Date(2026, 9, 8, 12, 0, 0, 0, time.UTC)

	var s Servicio
	if got := s.DiasDeMargen(ahora); got != -1 {
		t.Fatalf("sin consultar deberia ser -1, fue %d", got)
	}

	s.margen.set(time.Date(2027, 11, 1, 0, 0, 0, 0, time.UTC))
	if got := s.DiasDeMargen(ahora); got != 418 {
		t.Fatalf("margen = %d, esperaba 418", got)
	}

	// Ya dentro del hueco: el numero tiene que quedar en cero o negativo, no
	// envolverse ni quedar en -1, que significa otra cosa.
	s.margen.set(time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC))
	if got := s.DiasDeMargen(ahora); got > 0 {
		t.Fatalf("con la cobertura vencida el margen deberia ser <= 0, fue %d", got)
	}
}
