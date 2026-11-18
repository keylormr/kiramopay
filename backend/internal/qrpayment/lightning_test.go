package qrpayment

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/kiramopay/backend/internal/lightning"
)

func TestNormalizarSinpeMovil(t *testing.T) {
	buenos := map[string]string{
		"88887777":       "88887777",
		"8888-7777":      "88887777",
		"+506 6000 1234": "60001234",
		"506-7000-1234":  "70001234",
		" 5000 1234 ":    "50001234",
	}
	for entrada, quiero := range buenos {
		if got, err := NormalizarSinpeMovil(entrada); err != nil || got != quiero {
			t.Errorf("%q -> %q, %v; quiero %q", entrada, got, err, quiero)
		}
	}
	// Fijos (2 y 4), cortos, largos y otro pais.
	for _, malo := range []string{"", "2222-2222", "4000-1234", "8888777", "888877776", "+1 305 555 1234", "9888-7777"} {
		if _, err := NormalizarSinpeMovil(malo); !errors.Is(err, ErrSinpeMovilInvalido) {
			t.Errorf("%q no se rechazo: %v", malo, err)
		}
	}
}

func TestVentanaDelMes(t *testing.T) {
	desde, hasta, err := ventanaDelMes("2026-11", 360)
	if err != nil {
		t.Fatal(err)
	}
	// Medianoche del 1 de noviembre en Costa Rica (UTC-6) son las 06:00 UTC.
	if !desde.Equal(time.Date(2026, 11, 1, 6, 0, 0, 0, time.UTC)) || !hasta.Equal(time.Date(2026, 12, 1, 6, 0, 0, 0, time.UTC)) {
		t.Fatalf("ventana %v - %v", desde, hasta)
	}
	// Diciembre pasa al ano siguiente.
	_, hasta, _ = ventanaDelMes("2026-12", 0)
	if !hasta.Equal(time.Date(2027, 1, 1, 0, 0, 0, 0, time.UTC)) {
		t.Fatalf("fin de diciembre %v", hasta)
	}
	for _, malo := range []string{"", "2026", "2026-13", "11-2026", "2026-11-01"} {
		if _, _, err := ventanaDelMes(malo, 360); !errors.Is(err, ErrMesInvalido) {
			t.Errorf("%q: %v", malo, err)
		}
	}
}

func TestErrorDelEstado(t *testing.T) {
	ahora := time.Now()
	casos := map[string]error{
		EstadoCobroPagado:      ErrCobroYaPagado,
		EstadoCobroCancelado:   ErrCobroCancelado,
		EstadoCobroReemplazado: ErrCobroReemplazado,
		EstadoCobroVencido:     ErrCobroVencido,
	}
	for estado, quiero := range casos {
		if err := errorDelEstado(&QRCharge{Status: estado, ExpiresAt: ahora.Add(time.Hour)}, ahora); !errors.Is(err, quiero) {
			t.Errorf("%s: %v", estado, err)
		}
	}
	// Pendiente pero con el plazo cumplido: vencido, aunque el barrido no paso.
	if err := errorDelEstado(&QRCharge{Status: EstadoCobroPendiente, ExpiresAt: ahora}, ahora); !errors.Is(err, ErrCobroVencido) {
		t.Errorf("pendiente vencido: %v", err)
	}
}

// Cada rechazo con su codigo: la pantalla decide que decir por el codigo.
// El rol que no alcanza y el comercio que no existe son un 404; el cierre se
// dice; y una base que no contesta no se disfraza de comercio inexistente.
func TestNoEncontradoSiNoEsCierre(t *testing.T) {
	if err := noEncontradoSiNoEsCierre(fmt.Errorf("merchant not found")); !errors.Is(err, ErrComercioNoEncontrado) {
		t.Fatalf("sin rol: %v", err)
	}
	if err := noEncontradoSiNoEsCierre(ErrComercioCerrado); !errors.Is(err, ErrComercioCerrado) {
		t.Fatalf("cerrado: %v", err)
	}
	caida := errors.New("conn refused")
	if err := noEncontradoSiNoEsCierre(caida); errors.Is(err, ErrComercioNoEncontrado) || !errors.Is(err, caida) {
		t.Fatalf("la base caida salio como %v", err)
	}
}

func TestResponderErrorLightning(t *testing.T) {
	envuelto := func(e error) error { return fmt.Errorf("algo: %w", e) }
	casos := []struct {
		err       error
		alGuardar bool
		http      int
		codigo    string
	}{
		{ErrLightningNoDisponible, false, http.StatusServiceUnavailable, "LIGHTNING_UNAVAILABLE"},
		{ErrLightningSinDireccion, false, http.StatusConflict, "LIGHTNING_NO_ADDRESS"},
		{ErrSinpeMovilInvalido, true, http.StatusBadRequest, "SINPE_MOVIL_INVALID"},
		{ErrMesInvalido, false, http.StatusBadRequest, "INVALID_MONTH"},
		{envuelto(ErrPrecioLightningViejo), false, http.StatusServiceUnavailable, "PRICE_STALE"},
		{envuelto(ErrPrecioLightning), false, http.StatusServiceUnavailable, "PRICE_UNAVAILABLE"},
		{envuelto(ErrComercioNoEncontrado), false, http.StatusNotFound, "MERCHANT_NOT_FOUND"},
		{ErrComercioCerrado, false, http.StatusConflict, "MERCHANT_CLOSED"},
		// La direccion que escribe el dueno se le devuelve para corregir...
		{lightning.ErrDireccionInvalida, true, http.StatusUnprocessableEntity, "LIGHTNING_ADDRESS_INVALID"},
		{envuelto(lightning.ErrDominioNoPermitido), true, http.StatusUnprocessableEntity, "LIGHTNING_ADDRESS_INVALID"},
		{envuelto(lightning.ErrProveedor), true, http.StatusUnprocessableEntity, "LIGHTNING_ADDRESS_INVALID"},
		// ...y al cobrar es el proveedor el que fallo.
		{envuelto(lightning.ErrDominioNoPermitido), false, http.StatusBadGateway, "LIGHTNING_PROVIDER_FAILED"},
		{envuelto(lightning.ErrProveedor), false, http.StatusBadGateway, "LIGHTNING_PROVIDER_FAILED"},
		{lightning.ErrSinVerificacion, false, http.StatusBadGateway, "LIGHTNING_PROVIDER_FAILED"},
		{lightning.ErrFacturaNoCorresponde, false, http.StatusBadGateway, "LIGHTNING_PROVIDER_FAILED"},
		{lightning.ErrFueraDeRango, false, http.StatusUnprocessableEntity, "LIGHTNING_AMOUNT_OUT_OF_RANGE"},
		// Los del cobro, con los codigos que la pantalla ya conoce.
		{ErrQRInvalido, false, http.StatusBadRequest, "QR_INVALIDO"},
		{ErrCobroYaPagado, false, http.StatusConflict, "COBRO_YA_PAGADO"},
		{ErrCobroVencido, false, http.StatusConflict, "COBRO_VENCIDO"},
		{errors.New("la base se cayo"), false, http.StatusInternalServerError, "LIGHTNING_FAILED"},
	}
	for _, c := range casos {
		rec := httptest.NewRecorder()
		responderErrorLightning(rec, "LIGHTNING_FAILED", c.err, c.alGuardar)
		var cuerpo struct {
			Error struct {
				Code string `json:"code"`
			} `json:"error"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &cuerpo)
		if rec.Code != c.http || cuerpo.Error.Code != c.codigo {
			t.Errorf("%v (alGuardar=%v): %d %s; quiero %d %s (cuerpo %s)", c.err, c.alGuardar, rec.Code,
				cuerpo.Error.Code, c.http, c.codigo, rec.Body.String())
		}
	}
}
