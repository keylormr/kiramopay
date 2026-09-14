package response

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type fila struct {
	ID string `json:"id"`
}

func cuerpoDe(t *testing.T, data interface{}) string {
	t.Helper()
	rec := httptest.NewRecorder()
	JSON(rec, http.StatusOK, data)
	return strings.TrimSpace(rec.Body.String())
}

// El defecto: un repositorio sin filas devuelve un slice nil, y la respuesta
// salia con `data: null`. La pantalla de dividir cuenta lo tomaba por un error
// de carga y nunca mostraba su estado vacio.
func TestJSON_UnaListaSinFilasSaleComoArregloVacio(t *testing.T) {
	var sinFilas []fila
	if got, want := cuerpoDe(t, sinFilas), `{"success":true,"data":[]}`; got != want {
		t.Fatalf("cuerpo = %s, se esperaba %s", got, want)
	}
}

// Lo que ya funcionaba no cambia: una lista vacia o con filas sale igual.
func TestJSON_LasListasConValorNoCambian(t *testing.T) {
	if got, want := cuerpoDe(t, []fila{}), `{"success":true,"data":[]}`; got != want {
		t.Fatalf("lista vacia = %s, se esperaba %s", got, want)
	}
	if got, want := cuerpoDe(t, []fila{{ID: "a"}}), `{"success":true,"data":[{"id":"a"}]}`; got != want {
		t.Fatalf("lista con filas = %s, se esperaba %s", got, want)
	}
}

// Solo se tocan listas: un nil sin tipo sigue omitiendo `data`, y un mapa o un
// puntero nil siguen siendo `null`, porque ahi no hay filas que contar.
func TestJSON_SoloNormalizaListas(t *testing.T) {
	if got, want := cuerpoDe(t, nil), `{"success":true}`; got != want {
		t.Fatalf("nil sin tipo = %s, se esperaba %s", got, want)
	}
	var mapa map[string]int
	if got, want := cuerpoDe(t, mapa), `{"success":true,"data":null}`; got != want {
		t.Fatalf("mapa nil = %s, se esperaba %s", got, want)
	}
	var puntero *fila
	if got, want := cuerpoDe(t, puntero), `{"success":true,"data":null}`; got != want {
		t.Fatalf("puntero nil = %s, se esperaba %s", got, want)
	}
}
