package docs_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/kiramopay/backend/internal/docs"
)

var rutasDeLaDocumentacion = []string{"/api/docs", "/api/docs/openapi.yaml"}

func pedir(r http.Handler, ruta string) int {
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, ruta, nil))
	return rec.Code
}

// La documentacion de la API no se publica fuera de desarrollo. La API no es
// publica para terceros y la app no la usa: el mapa completo de las rutas de
// una billetera solo le sirve a quien la quiera atacar. Cualquier entorno que
// no sea desarrollo de forma explicita cuenta como produccion, tambien uno
// vacio o mal escrito: ENVIRONMENT nace en "production".
func TestMontar_FueraDeDesarrolloLaDocumentacionNoExiste(t *testing.T) {
	for _, entorno := range []string{"production", "staging", "", "Development"} {
		r := chi.NewRouter()
		docs.Montar(r, entorno)
		for _, ruta := range rutasDeLaDocumentacion {
			if c := pedir(r, ruta); c != http.StatusNotFound {
				t.Errorf("entorno %q: %s responde %d, esperaba 404", entorno, ruta, c)
			}
		}
	}
}

func TestMontar_EnDesarrolloLaDocumentacionResponde(t *testing.T) {
	r := chi.NewRouter()
	docs.Montar(r, "development")
	for _, ruta := range rutasDeLaDocumentacion {
		if c := pedir(r, ruta); c != http.StatusOK {
			t.Errorf("%s responde %d en desarrollo, esperaba 200", ruta, c)
		}
	}
}
