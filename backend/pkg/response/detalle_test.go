package response

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestErrorConDetalle_Un4xxLlevaElDetalle(t *testing.T) {
	rec := httptest.NewRecorder()
	ErrorConDetalle(rec, http.StatusConflict, "CARD_LIMIT", "limite",
		map[string]any{"plan": "free", "limite": 1, "actuales": 1})

	if rec.Code != http.StatusConflict {
		t.Fatalf("codigo %d, se esperaba 409", rec.Code)
	}
	var env struct {
		Success bool `json:"success"`
		Error   struct {
			Code    string `json:"code"`
			Details struct {
				Plan     string `json:"plan"`
				Limite   int    `json:"limite"`
				Actuales int    `json:"actuales"`
			} `json:"details"`
		} `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("no es JSON: %s", rec.Body.String())
	}
	if env.Success || env.Error.Code != "CARD_LIMIT" || env.Error.Details.Plan != "free" ||
		env.Error.Details.Limite != 1 || env.Error.Details.Actuales != 1 {
		t.Fatalf("respuesta inesperada: %s", rec.Body.String())
	}
}

// Un 5xx no filtra el detalle: responde exactamente lo mismo que Error.
func TestErrorConDetalle_Un5xxNoFiltraNada(t *testing.T) {
	rec := httptest.NewRecorder()
	ErrorConDetalle(rec, http.StatusInternalServerError, "BOOM", "pq: relation secreta",
		map[string]any{"sql": "SELECT * FROM users"})

	cuerpo := rec.Body.String()
	for _, filtrado := range []string{"details", "secreta", "SELECT"} {
		if strings.Contains(cuerpo, filtrado) {
			t.Fatalf("el 5xx filtro %q: %s", filtrado, cuerpo)
		}
	}
	if !strings.Contains(cuerpo, "internal server error") {
		t.Fatalf("el 5xx no dice el mensaje generico: %s", cuerpo)
	}
}

// Los errores de siempre no cambian de forma: sin detalle, no hay clave.
func TestError_SinDetalleNoEmiteLaClave(t *testing.T) {
	rec := httptest.NewRecorder()
	Error(rec, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
	if strings.Contains(rec.Body.String(), "details") {
		t.Fatalf("un error sin detalle emite la clave: %s", rec.Body.String())
	}
}
