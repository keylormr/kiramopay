package cards

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/kiramopay/backend/internal/plans"
)

// Crear una tarjeta tenia dos defectos de cara a la persona:
//   - el titular salia "Titular KiramoPay" para todos (un TODO en el handler);
//   - cualquier fallo volvia como 400 CREATE_FAILED con err.Error() crudo, es
//     decir, el texto del controlador de la base ("ERROR: ... SQLSTATE 22001").

func cuerpoDeError(t *testing.T, rec *httptest.ResponseRecorder) (codigo, mensaje string) {
	t.Helper()
	var body struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("la respuesta no es JSON: %s", rec.Body.String())
	}
	return body.Error.Code, body.Error.Message
}

func TestResponderErrorDeCreacion_CadaMotivoTieneSuCodigo(t *testing.T) {
	casos := []struct {
		nombre string
		err    error
		estado int
		codigo string
	}{
		{"moneda", ErrMonedaInvalida, http.StatusBadRequest, "INVALID_CURRENCY"},
		{"tipo", ErrTipoDeTarjetaInvalido, http.StatusBadRequest, "INVALID_CARD_TYPE"},
		{"sin nombre", ErrSinNombre, http.StatusConflict, "CARDHOLDER_NAME_MISSING"},
		{"envuelto", fmt.Errorf("crear: %w", ErrMonedaInvalida), http.StatusBadRequest, "INVALID_CURRENCY"},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			rec := httptest.NewRecorder()
			responderErrorDeCreacion(rec, c.err)
			if rec.Code != c.estado {
				t.Fatalf("estado %d, se esperaba %d: %s", rec.Code, c.estado, rec.Body.String())
			}
			if codigo, _ := cuerpoDeError(t, rec); codigo != c.codigo {
				t.Fatalf("codigo %q, se esperaba %q", codigo, c.codigo)
			}
		})
	}
}

func TestResponderErrorDeCreacion_ElTopeDelPlanSigueSiendo409ConDetalle(t *testing.T) {
	rec := httptest.NewRecorder()
	responderErrorDeCreacion(rec, &plans.TopeAlcanzadoError{Plan: "free", Limite: 1, Actuales: 1})

	if rec.Code != http.StatusConflict {
		t.Fatalf("estado %d, se esperaba 409: %s", rec.Code, rec.Body.String())
	}
	if codigo, _ := cuerpoDeError(t, rec); codigo != "CARD_LIMIT" {
		t.Fatalf("codigo %q, se esperaba CARD_LIMIT", codigo)
	}
	if !strings.Contains(rec.Body.String(), `"limite":1`) {
		t.Fatalf("falta el detalle del tope: %s", rec.Body.String())
	}
}

func TestResponderErrorDeCreacion_LoInesperadoEsUn500SinElDetalle(t *testing.T) {
	crudo := errors.New(`ERROR: value too long for type character varying(200) (SQLSTATE 22001)`)
	rec := httptest.NewRecorder()
	responderErrorDeCreacion(rec, fmt.Errorf("insert virtual_cards: %w", crudo))

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("estado %d, se esperaba 500: %s", rec.Code, rec.Body.String())
	}
	codigo, mensaje := cuerpoDeError(t, rec)
	if codigo != "CREATE_FAILED" {
		t.Fatalf("codigo %q, se esperaba CREATE_FAILED", codigo)
	}
	for _, pista := range []string{"SQLSTATE", "virtual_cards", "varying", "ERROR:"} {
		if strings.Contains(mensaje, pista) || strings.Contains(rec.Body.String(), pista) {
			t.Fatalf("la respuesta deja ver el error de la base (%q): %s", pista, rec.Body.String())
		}
	}
}

func TestValidarPeticionDeTarjeta(t *testing.T) {
	t.Run("sin datos usa colones y virtual", func(t *testing.T) {
		req := &CreateCardRequest{}
		if err := validarPeticionDeTarjeta(req); err != nil {
			t.Fatalf("una peticion vacia es valida: %v", err)
		}
		if req.Currency != "CRC" || req.Type != "virtual" {
			t.Fatalf("defaults = %s/%s, se esperaba CRC/virtual", req.Currency, req.Type)
		}
	})
	t.Run("la moneda se normaliza", func(t *testing.T) {
		req := &CreateCardRequest{Currency: " usd ", Type: "virtual"}
		if err := validarPeticionDeTarjeta(req); err != nil {
			t.Fatalf("usd es una moneda de la app: %v", err)
		}
		if req.Currency != "USD" {
			t.Fatalf("moneda = %q, se esperaba USD", req.Currency)
		}
	})
	t.Run("una moneda que la app no maneja se rechaza", func(t *testing.T) {
		for _, m := range []string{"EUR", "BTC", "colones", "CRC; DROP TABLE virtual_cards"} {
			if err := validarPeticionDeTarjeta(&CreateCardRequest{Currency: m}); !errors.Is(err, ErrMonedaInvalida) {
				t.Fatalf("moneda %q: error = %v, se esperaba ErrMonedaInvalida", m, err)
			}
		}
	})
	t.Run("un tipo desconocido se rechaza", func(t *testing.T) {
		if err := validarPeticionDeTarjeta(&CreateCardRequest{Type: "gold"}); !errors.Is(err, ErrTipoDeTarjetaInvalido) {
			t.Fatalf("error = %v, se esperaba ErrTipoDeTarjetaInvalido", err)
		}
	})
}

func TestTitular_EsElNombreDeLaPersona(t *testing.T) {
	ctx := context.Background()

	t.Run("nombre y apellido", func(t *testing.T) {
		h := NewHandler(nil).ConNombreDe(func(_ context.Context, id string) (string, error) {
			if id != "u1" {
				t.Fatalf("pregunto por %q, no por la persona que pide la tarjeta", id)
			}
			return "  Keilor   Martinez ", nil
		})
		nombre, err := h.titular(ctx, "u1")
		if err != nil {
			t.Fatalf("titular: %v", err)
		}
		if nombre != "Keilor Martinez" {
			t.Fatalf("titular = %q, se esperaba el nombre sin espacios de mas", nombre)
		}
	})

	t.Run("nunca el rotulo generico de antes", func(t *testing.T) {
		h := NewHandler(nil).ConNombreDe(func(context.Context, string) (string, error) { return "Ana Mora", nil })
		nombre, _ := h.titular(ctx, "u1")
		if strings.Contains(strings.ToLower(nombre), "titular") {
			t.Fatalf("titular = %q", nombre)
		}
	})

	t.Run("sin nombre en el perfil no se inventa uno", func(t *testing.T) {
		h := NewHandler(nil).ConNombreDe(func(context.Context, string) (string, error) { return "   ", nil })
		if _, err := h.titular(ctx, "u1"); !errors.Is(err, ErrSinNombre) {
			t.Fatalf("error = %v, se esperaba ErrSinNombre", err)
		}
	})

	t.Run("si no se pudo leer el perfil es un fallo, no un nombre", func(t *testing.T) {
		h := NewHandler(nil).ConNombreDe(func(context.Context, string) (string, error) { return "", errors.New("la base no responde") })
		_, err := h.titular(ctx, "u1")
		if err == nil || errors.Is(err, ErrSinNombre) {
			t.Fatalf("error = %v, se esperaba un fallo distinto de ErrSinNombre", err)
		}
	})

	t.Run("sin buscador cableado tampoco se inventa", func(t *testing.T) {
		if _, err := NewHandler(nil).titular(ctx, "u1"); err == nil {
			t.Fatal("sin buscador de nombres no hay titular que dar")
		}
	})
}
