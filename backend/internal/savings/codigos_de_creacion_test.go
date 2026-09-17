package savings

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

// Crear una meta con objetivo en cero respondia CREATE_FAILED "target must be
// positive", el mismo codigo que cualquier otro fallo, y la pantalla solo
// podia decir "no se pudo crear la meta". Cada rechazo de entrada tiene ahora
// su codigo. Todos ocurren antes de tocar la base: la prueba no la necesita.
func TestCrearMetaRechazaConCodigoPropio(t *testing.T) {
	h := NewHandler(NewService(nil, nil, nil))

	casos := []struct {
		nombre string
		cuerpo string
		codigo string
	}{
		{"objetivo en cero", `{"name":"Casa","target_minor":0}`, "SAVINGS_INVALID_TARGET"},
		{"objetivo negativo", `{"name":"Casa","target_minor":-50000}`, "SAVINGS_INVALID_TARGET"},
		{"sin nombre", `{"name":"","target_minor":100000}`, "SAVINGS_NAME_REQUIRED"},
		{"nombre de solo espacios", `{"name":"   ","target_minor":100000}`, "SAVINGS_NAME_REQUIRED"},
		{"nombre de 121 caracteres", `{"name":"` + strings.Repeat("a", 121) + `","target_minor":100000}`, "SAVINGS_NAME_TOO_LONG"},
		{"moneda desconocida", `{"name":"Casa","target_minor":100000,"currency":"EUR"}`, "SAVINGS_INVALID_CURRENCY"},
		{"color demasiado largo", `{"name":"Casa","target_minor":100000,"color":"` + strings.Repeat("f", 21) + `"}`, "SAVINGS_INVALID_STYLE"},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/api/v1/savings/goals", strings.NewReader(c.cuerpo))
			req = req.WithContext(context.WithValue(req.Context(), middleware.UserIDKey, "00000000-0000-0000-0000-000000000001"))
			rec := httptest.NewRecorder()

			h.Create(rec, req)

			if rec.Code != http.StatusBadRequest {
				t.Fatalf("estado %d, se esperaba 400: %s", rec.Code, rec.Body.String())
			}
			var sobre sobreDeError
			if err := json.Unmarshal(rec.Body.Bytes(), &sobre); err != nil {
				t.Fatalf("respuesta ilegible: %v", err)
			}
			if sobre.Error.Code != c.codigo {
				t.Fatalf("codigo %q, se esperaba %q", sobre.Error.Code, c.codigo)
			}
		})
	}
}

// El nombre de 120 caracteres es valido (el largo de la columna), contado en
// caracteres y no en bytes: una tilde no lo deja afuera.
func TestNombreDeMetaSeCuentaEnCaracteres(t *testing.T) {
	svc := NewService(nil, nil, nil)
	nombre := strings.Repeat("á", 120) // 240 bytes

	// Con el objetivo en cero la validacion se detiene antes de la base: si el
	// nombre pasa, el error es el del objetivo.
	if _, err := svc.Create(context.Background(), "u", &CreateGoalRequest{Name: nombre}); !errors.Is(err, ErrObjetivoInvalido) {
		t.Fatalf("120 caracteres: err = %v, se esperaba que el nombre pasara", err)
	}
	if _, err := svc.Create(context.Background(), "u", &CreateGoalRequest{Name: nombre + "x"}); !errors.Is(err, ErrNombreMuyLargo) {
		t.Fatalf("121 caracteres: err = %v, se esperaba ErrNombreMuyLargo", err)
	}
}

// Lo que no es un rechazo de entrada es una falla del servidor: ya no sale
// como 400 con el texto del driver.
func TestFallaDelServidorNoEsUnRechazo(t *testing.T) {
	if _, _, ok := rechazoAlCrear(errors.New("pq: connection refused")); ok {
		t.Fatal("un error de la base se tomo por rechazo de entrada")
	}
}
