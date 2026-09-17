package recurring

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/kiramopay/backend/internal/middleware"
)

type sobreDeError struct {
	Success bool `json:"success"`
	Error   struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

const usuario = "00000000-0000-0000-0000-000000000001"

func pedido(metodo, url, cuerpo, id string) *http.Request {
	req := httptest.NewRequest(metodo, url, strings.NewReader(cuerpo))
	ctx := context.WithValue(req.Context(), middleware.UserIDKey, usuario)
	if id != "" {
		rctx := chi.NewRouteContext()
		rctx.URLParams.Add("id", id)
		ctx = context.WithValue(ctx, chi.RouteCtxKey, rctx)
	}
	return req.WithContext(ctx)
}

func leer(t *testing.T, rec *httptest.ResponseRecorder) sobreDeError {
	t.Helper()
	var sobre sobreDeError
	if err := json.Unmarshal(rec.Body.Bytes(), &sobre); err != nil {
		t.Fatalf("respuesta ilegible: %v (%s)", err, rec.Body.String())
	}
	return sobre
}

func cuerpoValido(cambio func(m map[string]any)) string {
	m := map[string]any{
		"label": "Recibo de luz", "type": "service", "amount": 3245000,
		"frequency": "monthly", "next_date": "2026-10-05",
	}
	cambio(m)
	b, _ := json.Marshal(m)
	return string(b)
}

// Cada rechazo de entrada tiene su codigo. Una fecha mal escrita llegaba a la
// base y la respuesta traia el error de Postgres; ahora se decide antes.
func TestCrearPagoFijoRechazaConCodigoPropio(t *testing.T) {
	h := NewHandler(NewService(nil))
	casos := []struct {
		nombre string
		cambio func(m map[string]any)
		codigo string
	}{
		{"sin nombre", func(m map[string]any) { m["label"] = " " }, "RECURRING_LABEL_REQUIRED"},
		{"nombre de 201 caracteres", func(m map[string]any) { m["label"] = strings.Repeat("a", 201) }, "RECURRING_LABEL_TOO_LONG"},
		{"monto en cero", func(m map[string]any) { m["amount"] = 0 }, "RECURRING_INVALID_AMOUNT"},
		{"tipo desconocido", func(m map[string]any) { m["type"] = "crypto" }, "RECURRING_INVALID_TYPE"},
		{"frecuencia desconocida", func(m map[string]any) { m["frequency"] = "daily" }, "RECURRING_INVALID_FREQUENCY"},
		{"sin fecha", func(m map[string]any) { m["next_date"] = "" }, "RECURRING_INVALID_DATE"},
		{"fecha ambigua", func(m map[string]any) { m["next_date"] = "05/10/2026" }, "RECURRING_INVALID_DATE"},
		{"fecha imposible", func(m map[string]any) { m["next_date"] = "2026-02-30" }, "RECURRING_INVALID_DATE"},
		{"moneda desconocida", func(m map[string]any) { m["currency"] = "EUR" }, "RECURRING_INVALID_FIELD"},
		{"telefono demasiado largo", func(m map[string]any) { m["recipient_phone"] = strings.Repeat("8", 16) }, "RECURRING_INVALID_FIELD"},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			rec := httptest.NewRecorder()
			h.Create(rec, pedido(http.MethodPost, "/api/v1/recurring", cuerpoValido(c.cambio), ""))
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("estado %d, se esperaba 400: %s", rec.Code, rec.Body.String())
			}
			if got := leer(t, rec).Error.Code; got != c.codigo {
				t.Fatalf("codigo %q, se esperaba %q", got, c.codigo)
			}
		})
	}
}

func TestActualizarPagoFijoRechazaConCodigoPropio(t *testing.T) {
	h := NewHandler(NewService(nil))
	const id = "11111111-1111-1111-1111-111111111111"
	casos := []struct {
		nombre, cuerpo, codigo string
	}{
		{"monto negativo", `{"amount":-1}`, "RECURRING_INVALID_AMOUNT"},
		{"frecuencia desconocida", `{"frequency":"yearly"}`, "RECURRING_INVALID_FREQUENCY"},
		{"fecha mal escrita", `{"next_date":"mañana"}`, "RECURRING_INVALID_DATE"},
		{"nombre vacio", `{"label":""}`, "RECURRING_LABEL_REQUIRED"},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			rec := httptest.NewRecorder()
			h.Update(rec, pedido(http.MethodPatch, "/api/v1/recurring/"+id, c.cuerpo, id))
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("estado %d, se esperaba 400: %s", rec.Code, rec.Body.String())
			}
			if got := leer(t, rec).Error.Code; got != c.codigo {
				t.Fatalf("codigo %q, se esperaba %q", got, c.codigo)
			}
		})
	}
}

// Un id que no es UUID no existe, en las cuatro acciones sobre un pago.
func TestIdQueNoEsUUIDNoExiste(t *testing.T) {
	h := NewHandler(NewService(nil))
	acciones := map[string]func(w http.ResponseWriter, r *http.Request){
		"update":    h.Update,
		"delete":    h.Delete,
		"toggle":    h.Toggle,
		"mark-paid": h.MarkPaid,
	}
	for nombre, accion := range acciones {
		rec := httptest.NewRecorder()
		accion(rec, pedido(http.MethodPost, "/api/v1/recurring/rec-1", `{"amount":100}`, "rec-1"))
		if rec.Code != http.StatusNotFound || leer(t, rec).Error.Code != "RECURRING_NOT_FOUND" {
			t.Fatalf("%s: estado %d %s", nombre, rec.Code, rec.Body.String())
		}
	}
}

// Una falla de la base ya no se reporta como "no existe" ni filtra su texto.
func TestFallaDelServidorNoSeDisfrazaDeNoEncontrado(t *testing.T) {
	rec := httptest.NewRecorder()
	escribirError(rec, errors.New("toggle recurring payment: pq: connection refused"), "TOGGLE_FAILED")
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("estado %d, se esperaba 500", rec.Code)
	}
	sobre := leer(t, rec)
	if sobre.Error.Code != "TOGGLE_FAILED" || strings.Contains(sobre.Error.Message, "connection") {
		t.Fatalf("respuesta inesperada: %s", rec.Body.String())
	}
}
