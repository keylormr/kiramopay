package payment

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/kiramopay/backend/internal/contract"
	"github.com/kiramopay/backend/internal/middleware"
)

// La pantalla de Servicios llevaba escrita a mano la lista de empresas: 11 de
// las 15 no existian aqui y respondian INVALID_PROVIDER. Ahora la lista sale de
// GET /api/v1/services/providers, y el mismo endpoint dice si el cobro se puede
// entregar (convenios), para que la pantalla lo avise ANTES del formulario en
// vez de dejar que la persona lo llene y se tope con SIN_CONVENIO.

type catalogoFalso struct {
	proveedores []ProviderInfo
	err         error
}

func (c catalogoFalso) ListActiveProviders(context.Context) ([]ProviderInfo, error) {
	return c.proveedores, c.err
}

func llamarCatalogo(t *testing.T, svc *Service) (int, map[string]any) {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "http://localhost:8080/api/v1/services/providers", nil)
	req = req.WithContext(context.WithValue(req.Context(), middleware.UserIDKey, "u1"))
	rec := httptest.NewRecorder()
	NewHandler(svc).GetProviders(rec, req)
	var sobre map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &sobre); err != nil {
		t.Fatalf("la respuesta no es JSON: %v (%s)", err, rec.Body.String())
	}
	return rec.Code, sobre
}

func datos(t *testing.T, sobre map[string]any) map[string]any {
	t.Helper()
	d, ok := sobre["data"].(map[string]any)
	if !ok {
		t.Fatalf("la respuesta no trae data: %v", sobre)
	}
	return d
}

func TestCatalogo_ListaLoQueElServidorAcepta(t *testing.T) {
	svc := &Service{
		convenios: true,
		catalogo: catalogoFalso{proveedores: []ProviderInfo{
			{Code: "ice", Name: "ICE — Electricidad", Category: "electricity"},
			{Code: "aya", Name: "AyA — Agua", Category: "water"},
		}},
	}

	codigo, sobre := llamarCatalogo(t, svc)

	if codigo != http.StatusOK {
		t.Fatalf("codigo = %d, quiero 200: %v", codigo, sobre)
	}
	d := datos(t, sobre)
	if d["agreements_active"] != true {
		t.Errorf("agreements_active = %v, quiero true", d["agreements_active"])
	}
	proveedores, _ := d["providers"].([]any)
	if len(proveedores) != 2 {
		t.Fatalf("providers = %v, quiero 2", d["providers"])
	}
	primero := proveedores[0].(map[string]any)
	if primero["code"] != "ice" || primero["name"] != "ICE — Electricidad" || primero["category"] != "electricity" {
		t.Errorf("primer proveedor = %v", primero)
	}
}

// Sin convenios (produccion hoy) la lista igual sale: lo que cambia es la
// bandera, y la pantalla decide que mostrar.
func TestCatalogo_SinConveniosLoDice(t *testing.T) {
	svc := &Service{
		convenios: false,
		catalogo:  catalogoFalso{proveedores: []ProviderInfo{{Code: "ice", Name: "ICE", Category: "electricity"}}},
	}

	_, sobre := llamarCatalogo(t, svc)

	if got := datos(t, sobre)["agreements_active"]; got != false {
		t.Errorf("agreements_active = %v, quiero false", got)
	}
}

// Una tabla vacia (en produccion nadie sembro proveedores) es una lista vacia,
// no null: la pantalla itera sobre ella.
func TestCatalogo_SinProveedoresEsListaVacia(t *testing.T) {
	svc := &Service{catalogo: catalogoFalso{proveedores: nil}}

	_, sobre := llamarCatalogo(t, svc)

	d := datos(t, sobre)
	proveedores, ok := d["providers"].([]any)
	if !ok || len(proveedores) != 0 {
		t.Errorf("providers = %#v, quiero []", d["providers"])
	}
	operadores, ok := d["operators"].([]any)
	if !ok || len(operadores) == 0 {
		t.Errorf("operators = %#v, quiero la lista de operadores", d["operators"])
	}
}

func TestCatalogo_UnFalloDeLaBaseEsUn500(t *testing.T) {
	svc := &Service{catalogo: catalogoFalso{err: errors.New("conexion perdida")}}

	codigo, sobre := llamarCatalogo(t, svc)

	if codigo != http.StatusInternalServerError {
		t.Fatalf("codigo = %d, quiero 500", codigo)
	}
	e, _ := sobre["error"].(map[string]any)
	if e["code"] != "FETCH_FAILED" {
		t.Errorf("error = %v, quiero FETCH_FAILED", e)
	}
	if msg, _ := e["message"].(string); msg == "conexion perdida" {
		t.Errorf("el detalle interno no puede salir en un 5xx")
	}
}

func TestCatalogo_SinSesionEs401(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/services/providers", nil)
	rec := httptest.NewRecorder()

	NewHandler(&Service{catalogo: catalogoFalso{}}).GetProviders(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("codigo = %d, quiero 401", rec.Code)
	}
}

// Los operadores del catalogo son EXACTAMENTE los que Recharge acepta: un
// operador que la pantalla ofrece y el servidor rechaza (INVALID_OPERATOR) es el
// mismo defecto que tenian las empresas.
func TestOperadores_ElCatalogoYRechargeUsanLaMismaLista(t *testing.T) {
	if len(Operadores) == 0 {
		t.Fatal("no hay operadores")
	}
	vistos := map[string]bool{}
	for _, op := range Operadores {
		if vistos[op.Code] {
			t.Errorf("operador repetido: %s", op.Code)
		}
		vistos[op.Code] = true
		nombre, ok := nombreDelOperador(op.Code)
		if !ok || nombre != op.Name {
			t.Errorf("nombreDelOperador(%q) = %q, %v; quiero %q", op.Code, nombre, ok, op.Name)
		}
	}
	if _, ok := nombreDelOperador("tigo"); ok {
		t.Error("tigo no es un operador de recarga")
	}
}

// La respuesta cumple el contrato de openapi.yaml: lo que documentamos es lo
// que sale.
func TestCatalogo_CumpleElContrato(t *testing.T) {
	doc, err := contract.LoadSpec("../../docs/openapi.yaml")
	if err != nil {
		t.Fatalf("load spec: %v", err)
	}
	router, err := contract.NewRouter(doc)
	if err != nil {
		t.Fatalf("router: %v", err)
	}
	svc := &Service{
		convenios: true,
		catalogo: catalogoFalso{proveedores: []ProviderInfo{
			{Code: "ice", Name: "ICE — Electricidad", Category: "electricity"},
		}},
	}

	_, sobre := llamarCatalogo(t, svc)

	const url = "http://localhost:8080/api/v1/services/providers"
	if err := contract.ValidateData(router, http.MethodGet, url, http.StatusOK, sobre["data"]); err != nil {
		t.Errorf("GET /services/providers viola el esquema de openapi.yaml: %v", err)
	}
}
