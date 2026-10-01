package docs

import "github.com/go-chi/chi/v5"

// Montar registra la documentacion de la API (la pagina de Swagger y la
// especificacion que esa pagina lee) SOLO en desarrollo.
//
// En cualquier otro entorno las dos rutas no existen. La API no es publica para
// terceros y la app no la usa: publicar el mapa completo de las rutas de una
// billetera solo le sirve a quien la quiera atacar. Ademas la imagen de
// produccion no copia docs/, asi que la pagina cargaba y la especificacion que
// lee daba 404. Si algun dia un socio necesita la especificacion, se le publica
// la suya, con acceso, no esta.
//
// Se compara con "development" exacto y no con "distinto de production": un
// entorno vacio o mal escrito no la publica (ENVIRONMENT nace en "production",
// config.go), el mismo criterio que el eco del token de desarrollo.
func Montar(r chi.Router, entorno string) {
	if entorno != "development" {
		return
	}
	r.Get("/api/docs", ServeSwaggerUI)
	r.Get("/api/docs/openapi.yaml", ServeOpenAPISpec)
}
