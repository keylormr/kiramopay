package crypto

import (
	"fmt"
	"net/http"
	"testing"
)

// La pantalla decide por el codigo: envuelto en prefijos del servicio, el
// rechazo tiene que seguir saliendo con el suyo.
func TestLaPausaSaleConSuCodigo(t *testing.T) {
	r, ok := rechazoConocido(fmt.Errorf("buy BTC: %w", ErrComprasEnPausa))
	if !ok {
		t.Fatal("la pausa no se reconoce")
	}
	if r.estado != http.StatusServiceUnavailable || r.codigo != "CRYPTO_PAUSED" {
		t.Fatalf("salio %d %s", r.estado, r.codigo)
	}
}
