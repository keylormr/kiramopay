package plans

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestTopes_PorDefectoSonLosDecididosPorElDueno(t *testing.T) {
	if TopesMetasDeAhorro != (Topes{Free: 3, Plus: 10, Pro: 0}) {
		t.Errorf("metas = %+v, la decision es 3 / 10 / sin tope", TopesMetasDeAhorro)
	}
	if TopesTarjetas != (Topes{Free: 1, Plus: 3, Pro: 5}) {
		t.Errorf("tarjetas = %+v, la decision es 1 / 3 / 5", TopesTarjetas)
	}
	if PrecioPlusUSD != 11.99 || PrecioProUSD != 34.99 || PrecioAnaliticaUSD != 9.99 {
		t.Errorf("precios = %v / %v / %v, la decision es 11,99 / 34,99 / 9,99",
			PrecioPlusUSD, PrecioProUSD, PrecioAnaliticaUSD)
	}
}

func TestTopes_Para(t *testing.T) {
	casos := []struct {
		plan   string
		quiero int
	}{
		{PlanFree, 1},
		{PlanPlus, 3},
		{PlanPro, 5},
		// Lo que no se reconoce recibe el tope MAS estricto, nunca el ilimitado.
		{"", 1},
		{"PRO", 1},
		{"gold", 1},
	}
	for _, c := range casos {
		if got := TopesTarjetas.Para(c.plan); got != c.quiero {
			t.Errorf("TopesTarjetas.Para(%q) = %d, se esperaba %d", c.plan, got, c.quiero)
		}
	}
	if got := TopesMetasDeAhorro.Para(PlanPro); got != 0 {
		t.Errorf("metas de pro = %d, se esperaba 0 (sin tope)", got)
	}
}

func TestPlanPersonalValido(t *testing.T) {
	for _, valido := range []string{"free", "plus", "pro"} {
		if !PlanPersonalValido(valido) {
			t.Errorf("%q deberia ser valido", valido)
		}
	}
	for _, invalido := range []string{"", "Free", "PLUS", " pro", "pro ", "base", "analitica", "negocio", "cima"} {
		if PlanPersonalValido(invalido) {
			t.Errorf("%q no deberia ser valido", invalido)
		}
	}
}

func TestTopeAlcanzadoError_DetalleYErrorsAs(t *testing.T) {
	e := &TopeAlcanzadoError{Plan: PlanFree, Limite: 3, Actuales: 4}
	crudo, err := json.Marshal(e.Detalle())
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if string(crudo) != `{"actuales":4,"limite":3,"plan":"free"}` {
		t.Fatalf("detalle = %s", crudo)
	}
	var tope *TopeAlcanzadoError
	if !errors.As(fmt.Errorf("envuelto: %w", e), &tope) || tope.Actuales != 4 {
		t.Fatal("errors.As no encuentra el tope a traves de un envoltorio")
	}
}

func TestLlaveDeTope_SeparaRecursosYPersonas(t *testing.T) {
	a := llaveDeTope(RecursoMetasDeAhorro, "u1")
	if a != llaveDeTope(RecursoMetasDeAhorro, "u1") {
		t.Fatal("la llave no es determinista")
	}
	if a == llaveDeTope(RecursoTarjetas, "u1") {
		t.Fatal("metas y tarjetas de la misma persona comparten llave")
	}
	if a == llaveDeTope(RecursoMetasDeAhorro, "u2") {
		t.Fatal("dos personas comparten llave")
	}
}

func TestLeerPlanEstricto(t *testing.T) {
	casos := []struct {
		nombre, cuerpo string
		ok             bool
		plan, codigo   string
	}{
		{"exacto", `{"plan":"pro"}`, true, "pro", ""},
		{"espacios alrededor", " {\"plan\":\"plus\"} \n", true, "plus", ""},
		// El valor lo valida el servicio: aqui solo se exige la forma.
		{"valor en mayusculas pasa la forma", `{"plan":"PRO"}`, true, "PRO", ""},
		{"sin cuerpo", "", false, "", "PLAN_INVALID"},
		{"sin plan", `{}`, false, "", "PLAN_INVALID"},
		{"plan null", `{"plan":null}`, false, "", "PLAN_INVALID"},
		{"campo de mas", `{"plan":"pro","gratis":true}`, false, "", "INVALID_BODY"},
		{"dos objetos", `{"plan":"pro"}{"plan":"free"}`, false, "", "INVALID_BODY"},
		{"basura despues", `{"plan":"pro"} x`, false, "", "INVALID_BODY"},
		{"json roto", `{"plan":`, false, "", "INVALID_BODY"},
		{"plan no es texto", `{"plan":5}`, false, "", "INVALID_BODY"},
	}
	for _, c := range casos {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPatch, "/admin/users/x/plan", strings.NewReader(c.cuerpo))
		plan, ok := LeerPlanEstricto(rec, req)
		if ok != c.ok || plan != c.plan {
			t.Errorf("%s: ok=%v plan=%q, se esperaba ok=%v plan=%q", c.nombre, ok, plan, c.ok, c.plan)
			continue
		}
		if c.ok {
			if rec.Body.Len() != 0 {
				t.Errorf("%s: escribio una respuesta en un cuerpo valido: %s", c.nombre, rec.Body.String())
			}
			continue
		}
		var env struct {
			Error struct {
				Code string `json:"code"`
			} `json:"error"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
			t.Errorf("%s: la respuesta no es JSON: %s", c.nombre, rec.Body.String())
			continue
		}
		if rec.Code != http.StatusBadRequest || env.Error.Code != c.codigo {
			t.Errorf("%s: %d %s, se esperaba 400 %s", c.nombre, rec.Code, env.Error.Code, c.codigo)
		}
	}
}
