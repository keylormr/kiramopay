package docs

import "github.com/go-chi/chi/v5"

// Montar registra la documentacion de la API: la pagina de Swagger y la
// especificacion que esa pagina lee.
func Montar(r chi.Router, entorno string) {
	r.Get("/api/docs", ServeSwaggerUI)
	r.Get("/api/docs/openapi.yaml", ServeOpenAPISpec)
}
