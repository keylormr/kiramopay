package budget

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

// Antes todo rechazo salia como CREATE_FAILED/UPDATE_FAILED con el texto de
// fmt.Errorf, y los que llegaban a la base respondian con el error crudo de
// Postgres. Todos estos se deciden antes de tocar la base.
func TestCrearPresupuestoRechazaConCodigoPropio(t *testing.T) {
	h := NewHandler(NewService(nil))
	casos := []struct {
		nombre, cuerpo, codigo string
	}{
		{"sin nombre", `{"label":"  ","amount_limit":8000000}`, "BUDGET_LABEL_REQUIRED"},
		{"nombre de 101 caracteres", `{"label":"` + strings.Repeat("a", 101) + `","amount_limit":8000000}`, "BUDGET_LABEL_TOO_LONG"},
		{"tope en cero", `{"label":"Comida","amount_limit":0}`, "BUDGET_INVALID_LIMIT"},
		{"tope negativo", `{"label":"Comida","amount_limit":-1}`, "BUDGET_INVALID_LIMIT"},
		{"moneda de cuatro letras", `{"label":"Comida","amount_limit":100,"currency":"USDT"}`, "BUDGET_INVALID_FIELD"},
		{"periodo que nada entiende", `{"label":"Comida","amount_limit":100,"period":"yearly"}`, "BUDGET_INVALID_FIELD"},
		{"icono demasiado largo", `{"label":"Comida","amount_limit":100,"icon":"` + strings.Repeat("i", 51) + `"}`, "BUDGET_INVALID_FIELD"},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			rec := httptest.NewRecorder()
			h.Create(rec, pedido(http.MethodPost, "/api/v1/budgets", c.cuerpo, ""))
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("estado %d, se esperaba 400: %s", rec.Code, rec.Body.String())
			}
			if got := leer(t, rec).Error.Code; got != c.codigo {
				t.Fatalf("codigo %q, se esperaba %q", got, c.codigo)
			}
		})
	}
}

// Anotar lo gastado es un PATCH de amount_spent: un negativo no tiene sentido.
func TestActualizarPresupuestoRechazaConCodigoPropio(t *testing.T) {
	h := NewHandler(NewService(nil))
	const id = "11111111-1111-1111-1111-111111111111"
	casos := []struct {
		nombre, cuerpo, codigo string
	}{
		{"gastado negativo", `{"amount_spent":-100}`, "BUDGET_INVALID_SPENT"},
		{"tope en cero", `{"amount_limit":0}`, "BUDGET_INVALID_LIMIT"},
		{"nombre vacio", `{"label":""}`, "BUDGET_LABEL_REQUIRED"},
		{"color demasiado largo", `{"color":"` + strings.Repeat("c", 21) + `"}`, "BUDGET_INVALID_FIELD"},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			rec := httptest.NewRecorder()
			h.Update(rec, pedido(http.MethodPatch, "/api/v1/budgets/"+id, c.cuerpo, id))
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("estado %d, se esperaba 400: %s", rec.Code, rec.Body.String())
			}
			if got := leer(t, rec).Error.Code; got != c.codigo {
				t.Fatalf("codigo %q, se esperaba %q", got, c.codigo)
			}
		})
	}
}

// Un id que no es UUID no existe: 404, no un error de sintaxis de Postgres
// convertido en falla del servidor.
func TestIdQueNoEsUUIDNoExiste(t *testing.T) {
	h := NewHandler(NewService(nil))

	rec := httptest.NewRecorder()
	h.Update(rec, pedido(http.MethodPatch, "/api/v1/budgets/1", `{"amount_spent":100}`, "1"))
	if rec.Code != http.StatusNotFound || leer(t, rec).Error.Code != "BUDGET_NOT_FOUND" {
		t.Fatalf("update: estado %d %s", rec.Code, rec.Body.String())
	}

	rec = httptest.NewRecorder()
	h.Delete(rec, pedido(http.MethodDelete, "/api/v1/budgets/no-es-uuid", "", "no-es-uuid"))
	if rec.Code != http.StatusNotFound || leer(t, rec).Error.Code != "BUDGET_NOT_FOUND" {
		t.Fatalf("delete: estado %d %s", rec.Code, rec.Body.String())
	}
}

// Lo que no es un rechazo sale como falla del servidor, sin el texto crudo.
func TestFallaDelServidorNoFiltraElDetalle(t *testing.T) {
	rec := httptest.NewRecorder()
	escribirError(rec, errors.New("pq: relation budgets does not exist"), "UPDATE_FAILED")
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("estado %d, se esperaba 500", rec.Code)
	}
	sobre := leer(t, rec)
	if sobre.Error.Code != "UPDATE_FAILED" || strings.Contains(sobre.Error.Message, "relation") {
		t.Fatalf("respuesta inesperada: %s", rec.Body.String())
	}
}
