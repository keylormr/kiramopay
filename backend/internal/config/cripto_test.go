package config

import (
	"testing"
	"time"
)

// El refresco propio del barrido de alertas gasta cuota del proveedor: lo que
// diga la variable tiene que ser exactamente lo que corra.
func TestLoad_RefrescoDeAlertas(t *testing.T) {
	casos := []struct {
		nombre string
		valor  string
		quiere time.Duration
	}{
		{"sin variable manda el de fabrica", "", time.Hour},
		{"un 0 explicito apaga el refresco", "0", 0},
		{"un valor propio se respeta", "6", 6 * time.Hour},
		{"un negativo es un error de tipeo: vale el de fabrica", "-3", time.Hour},
		{"lo que no es numero vale el de fabrica", "cada rato", time.Hour},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			t.Setenv("ALERTAS_REFRESCO_HORAS", c.valor)
			if got := Load().Cripto.RefrescoDeAlertas; got != c.quiere {
				t.Fatalf("RefrescoDeAlertas = %s, se esperaba %s", got, c.quiere)
			}
		})
	}
}
