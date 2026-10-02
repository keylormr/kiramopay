package docs_test

import (
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/kiramopay/backend/internal/docs"
	"github.com/kiramopay/backend/internal/middleware"
)

var rutasDeLaDocumentacion = []string{"/api/docs", "/api/docs/openapi.yaml", "/api/docs/swagger-init.js"}

func pedir(r http.Handler, ruta string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, ruta, nil))
	return rec
}

// La documentacion de la API no se publica fuera de desarrollo: el mapa
// completo de las rutas de una billetera, las de administracion incluidas, no
// le sirve a nadie de afuera y le ahorra trabajo a quien busca por donde
// entrar. Cualquier entorno que no sea desarrollo de forma explicita cuenta
// como produccion, tambien uno vacio, mal escrito o parecido: ENVIRONMENT nace
// en "production".
func TestMontar_FueraDeDesarrolloLaDocumentacionNoExiste(t *testing.T) {
	for _, entorno := range []string{
		"production", "staging", "", "Development", "DEVELOPMENT", "dev", "development ", "developmentx",
	} {
		r := chi.NewRouter()
		docs.Montar(r, entorno)
		for _, ruta := range rutasDeLaDocumentacion {
			if c := pedir(r, ruta).Code; c != http.StatusNotFound {
				t.Errorf("entorno %q: %s responde %d, esperaba 404", entorno, ruta, c)
			}
		}
	}
}

func TestMontar_EnDesarrolloLaDocumentacionResponde(t *testing.T) {
	r := chi.NewRouter()
	docs.Montar(r, "development")
	for _, ruta := range rutasDeLaDocumentacion {
		if c := pedir(r, ruta).Code; c != http.StatusOK {
			t.Errorf("%s responde %d en desarrollo, esperaba 200", ruta, c)
		}
	}
}

// La pagina de Swagger salia en blanco en todo entorno, desarrollo incluido: la
// politica de seguridad del servidor (middleware.SecurityHeaders) no la dejaba
// cargar la hoja de estilo ni el script de unpkg.com, ni el script en linea que
// la arranca. La pagina lleva su propia politica, que permite lo que necesita
// y nada mas, y el script que la arranca se sirve aparte.
func TestMontar_LaPaginaPuedeCargarLoQueNecesita(t *testing.T) {
	r := chi.NewRouter()
	r.Use(middleware.SecurityHeaders)
	docs.Montar(r, "development")

	rec := pedir(r, "/api/docs")
	politica := directivas(rec.Header().Get("Content-Security-Policy"))
	for _, d := range []string{"script-src", "style-src"} {
		if !contiene(politica[d], "https://unpkg.com") {
			t.Errorf("%s = %v: la pagina no puede cargar Swagger UI desde unpkg.com", d, politica[d])
		}
	}
	if !contiene(politica["frame-ancestors"], "'none'") {
		t.Errorf("frame-ancestors = %v: la pagina se podria incrustar", politica["frame-ancestors"])
	}
	for _, etiqueta := range regexp.MustCompile(`<script[^>]*>`).FindAllString(rec.Body.String(), -1) {
		if !strings.Contains(etiqueta, "src=") {
			t.Errorf("%s: un script en linea no corre con script-src sin 'unsafe-inline'", etiqueta)
		}
	}

	arranque := pedir(r, "/api/docs/swagger-init.js")
	if tipo := arranque.Header().Get("Content-Type"); !strings.Contains(tipo, "javascript") {
		t.Errorf("el script de arranque sale como %q", tipo)
	}
	if !strings.Contains(arranque.Body.String(), "/api/docs/openapi.yaml") {
		t.Error("el script de arranque no apunta a la especificacion")
	}
}

func directivas(politica string) map[string][]string {
	d := map[string][]string{}
	for _, parte := range strings.Split(politica, ";") {
		campos := strings.Fields(parte)
		if len(campos) > 0 {
			d[campos[0]] = campos[1:]
		}
	}
	return d
}

func contiene(valores []string, buscado string) bool {
	for _, v := range valores {
		if v == buscado {
			return true
		}
	}
	return false
}
