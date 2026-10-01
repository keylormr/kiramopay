package docs

import (
	"net/http"
	"os"
	"path/filepath"
	"runtime"
)

// ServeOpenAPISpec serves the openapi.yaml file.
func ServeOpenAPISpec(w http.ResponseWriter, r *http.Request) {
	specPath := findSpecPath()
	data, err := os.ReadFile(specPath) // #nosec G304 -- specPath is resolved internally (findSpecPath), never user input
	if err != nil {
		http.Error(w, "OpenAPI spec not found", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/yaml")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	_, _ = w.Write(data)
}

// politicaDeLaPagina es la politica de seguridad de la pagina de Swagger. La del
// servidor (middleware.SecurityHeaders) no la deja cargar Swagger UI, que viene
// de unpkg.com, y la pagina salia en blanco. Esta permite eso y nada mas: el
// script que la arranca se sirve aparte (ServeSwaggerInit), asi que no hace
// falta permitir scripts en linea. La pagina solo existe en desarrollo
// (Montar).
const politicaDeLaPagina = "default-src 'self'; " +
	"script-src 'self' https://unpkg.com; " +
	"style-src 'self' 'unsafe-inline' https://unpkg.com; " +
	"img-src 'self' data:; " +
	"font-src 'self'; " +
	"connect-src 'self'; " +
	"frame-ancestors 'none'"

// ServeSwaggerUI serves a minimal Swagger UI page.
func ServeSwaggerUI(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Security-Policy", politicaDeLaPagina)
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = w.Write([]byte(swaggerHTML))
}

// ServeSwaggerInit sirve el script que arranca la pagina de Swagger.
func ServeSwaggerInit(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
	_, _ = w.Write([]byte(swaggerInit))
}

func findSpecPath() string {
	// Try relative to the binary
	candidates := []string{
		"docs/openapi.yaml",
		"backend/docs/openapi.yaml",
		"../../docs/openapi.yaml",
	}

	// Also try relative to this source file (development mode)
	_, filename, _, ok := runtime.Caller(0)
	if ok {
		srcDir := filepath.Dir(filename)
		candidates = append(candidates, filepath.Join(srcDir, "../../docs/openapi.yaml"))
	}

	for _, c := range candidates {
		if _, err := os.Stat(c); err == nil {
			return c
		}
	}
	return "docs/openapi.yaml"
}

const swaggerHTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>KiramoPay API Documentation</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css"/>
  <style>
    body { margin: 0; background: #fafafa; }
    .topbar { display: none !important; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script src="/api/docs/swagger-init.js"></script>
</body>
</html>`

// swaggerInit arranca la pagina. validatorUrl en null: sin eso Swagger UI le
// manda la direccion de la especificacion a validator.swagger.io. Con
// BaseLayout no hace falta el preset standalone, que solo agrega la barra de
// arriba que la hoja de estilo esconde.
const swaggerInit = `SwaggerUIBundle({
  url: '/api/docs/openapi.yaml',
  dom_id: '#swagger-ui',
  deepLinking: true,
  validatorUrl: null,
  presets: [SwaggerUIBundle.presets.apis],
  layout: 'BaseLayout',
});
`
