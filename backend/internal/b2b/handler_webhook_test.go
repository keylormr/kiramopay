package b2b

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/kiramopay/backend/internal/middleware"
)

type sobreDeError struct {
	Success bool `json:"success"`
	Error   struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

// Registrar un webhook con una URL que no sirve respondia "invalid request",
// sin decir que corregir. Ahora el rechazo tiene su propio codigo, y la hoja
// de webhooks lo traduce. La URL se valida antes de tocar la base, asi que
// esta prueba no necesita repositorio.
func TestCrearWebhookConURLInvalidaTieneCodigoPropio(t *testing.T) {
	h := NewHandler(NewService(nil, nil, nil, nil))

	for _, url := range []string{
		"esto-no-es-una-url",
		"",
		"ftp://8.8.8.8/hook",
		"http://127.0.0.1:9000/hook",
		"https://usuario:clave@8.8.8.8/hook",
	} {
		cuerpo, _ := json.Marshal(map[string]string{"url": url, "events": "*"})
		req := httptest.NewRequest(http.MethodPost, "/api/v1/b2b/webhooks", strings.NewReader(string(cuerpo)))
		req = req.WithContext(context.WithValue(req.Context(), middleware.UserIDKey, "00000000-0000-0000-0000-000000000001"))
		rec := httptest.NewRecorder()

		h.CreateWebhook(rec, req)

		if rec.Code != http.StatusBadRequest {
			t.Fatalf("%q: estado %d, se esperaba 400", url, rec.Code)
		}
		var sobre sobreDeError
		if err := json.Unmarshal(rec.Body.Bytes(), &sobre); err != nil {
			t.Fatalf("%q: respuesta ilegible: %v", url, err)
		}
		if sobre.Error.Code != "WEBHOOK_INVALID_URL" {
			t.Fatalf("%q: codigo %q, se esperaba WEBHOOK_INVALID_URL", url, sobre.Error.Code)
		}
		if strings.Contains(sobre.Error.Message, "invalid request") {
			t.Fatalf("%q: el mensaje sigue siendo el generico: %q", url, sobre.Error.Message)
		}
	}
}

// El error nuevo sigue siendo un ErrInvalid: quien lo trate como rechazo de
// entrada no cambia de comportamiento. Y un ErrInvalid que no es de URL
// conserva su codigo generico.
func TestLaURLInvalidaSigueSiendoUnRechazoDeEntrada(t *testing.T) {
	_, err := NewService(nil, nil, nil, nil).CreateEndpoint(context.Background(), "u", "esto-no-es-una-url", "*")
	if !errors.Is(err, ErrInvalid) || !errors.Is(err, ErrURLWebhookInvalida) {
		t.Fatalf("err = %v, se esperaba ErrInvalid y ErrURLWebhookInvalida", err)
	}

	rec := httptest.NewRecorder()
	NewHandler(nil).writeError(rec, ErrInvalid)
	var sobre sobreDeError
	if err := json.Unmarshal(rec.Body.Bytes(), &sobre); err != nil {
		t.Fatalf("respuesta ilegible: %v", err)
	}
	if rec.Code != http.StatusBadRequest || sobre.Error.Code != "INVALID_REQUEST" {
		t.Fatalf("ErrInvalid suelto: estado %d codigo %q, se esperaba 400 INVALID_REQUEST", rec.Code, sobre.Error.Code)
	}
}
