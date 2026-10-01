package docs

import "github.com/go-chi/chi/v5"

// Montar registra la documentacion de la API (la pagina de Swagger, el script
// que la arranca y la especificacion que lee) SOLO en desarrollo.
//
// En cualquier otro entorno las rutas no existen. La app no las usa, y el mapa
// completo de las rutas de una billetera, las de administracion incluidas, no
// le sirve a nadie de afuera y le ahorra trabajo a quien busca por donde
// entrar. En produccion la pagina ademas salia en blanco: la politica de
// seguridad del servidor no la dejaba cargar Swagger UI, y la especificacion
// daba 404. Si un comercio de la API B2B necesita la especificacion, lo que
// corresponde es entregarle la suya, no esta.
//
// Se compara con "development" exacto y no con "distinto de production": un
// entorno vacio o mal escrito no la publica (ENVIRONMENT nace en "production",
// config.go), el mismo criterio que el eco del token de desarrollo.
func Montar(r chi.Router, entorno string) {
	if entorno != "development" {
		return
	}
	r.Get("/api/docs", ServeSwaggerUI)
	r.Get("/api/docs/swagger-init.js", ServeSwaggerInit)
	r.Get("/api/docs/openapi.yaml", ServeOpenAPISpec)
}
