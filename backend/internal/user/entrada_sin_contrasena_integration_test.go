package user_test

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/kiramopay/backend/internal/testutil"
	"github.com/kiramopay/backend/internal/user"
)

// El perfil (GET /users/me) dice si la cuenta entra sin contrasena, para que la
// app no le ofrezca "Cambiar contrasena" ni "Eliminar cuenta", que fallan sin
// una contrasena actual. El servidor sigue rechazando las dos si alguien las
// llama directo (ver cambiar_contrasena_integration_test y
// handler_integration_test de accountdeletion).

func rutasDelPerfil(pool *pgxpool.Pool, entradaSinContrasenaEncendida bool) http.Handler {
	servicio := user.NewService(user.NewRepository(pool)).ConEntradaDeDemostracion(entradaSinContrasenaEncendida)
	h := user.NewHandler(servicio)
	r := chi.NewRouter()
	r.Get("/api/v1/users/me", h.GetProfile)
	r.Patch("/api/v1/users/me", h.UpdateProfile)
	return r
}

func marcarDemostracion(t *testing.T, pool *pgxpool.Pool, id string, demo bool) {
	t.Helper()
	if _, err := pool.Exec(context.Background(),
		`UPDATE users SET demo_login = $2 WHERE id = $1::uuid`, id, demo); err != nil {
		t.Fatalf("marcar la cuenta: %v", err)
	}
}

func entraSinContrasenaSegunElPerfil(t *testing.T, ruta http.Handler, userID string) bool {
	t.Helper()
	rec := pedirComo(ruta, userID, http.MethodGet, "/api/v1/users/me", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("perfil: %d %s", rec.Code, rec.Body.String())
	}
	var env struct {
		Data map[string]any `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("perfil: %v", err)
	}
	v, ok := env.Data["passwordless_login"]
	if !ok {
		t.Fatalf("el perfil no trae passwordless_login: %s", rec.Body.String())
	}
	return v == true
}

func TestPerfil_DiceSiLaCuentaEntraSinContrasena(t *testing.T) {
	pool := testutil.TestDB(t)
	uid := testutil.SeedTestUser(t, pool, "702650930", "dummy")

	// Cuenta normal: ni con la bandera encendida.
	if entraSinContrasenaSegunElPerfil(t, rutasDelPerfil(pool, true), uid) {
		t.Fatal("una cuenta normal figura como que entra sin contrasena")
	}

	// Cuenta de demostracion: depende de la bandera del servidor.
	marcarDemostracion(t, pool, uid, true)
	if !entraSinContrasenaSegunElPerfil(t, rutasDelPerfil(pool, true), uid) {
		t.Fatal("una cuenta de demostracion con la bandera encendida no figura como que entra sin contrasena")
	}
	if entraSinContrasenaSegunElPerfil(t, rutasDelPerfil(pool, false), uid) {
		t.Fatal("con la bandera apagada la cuenta de demostracion figura como que entra sin contrasena")
	}
}

// Ocultar las opciones en la app no es una proteccion: el servidor las rechaza
// aunque la llamada llegue directa.
func TestPerfil_LaCuentaQueEntraSinContrasenaSigueSinPoderCambiarSusDatos(t *testing.T) {
	pool := testutil.TestDB(t)
	uid := testutil.SeedTestUser(t, pool, "702650930", "dummy")
	marcarDemostracion(t, pool, uid, true)

	rec := pedirComo(rutasDelPerfil(pool, true), uid, http.MethodPatch, "/api/v1/users/me",
		`{"email":"otra@ejemplo.com"}`)
	var env struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("respuesta: %v (%s)", err, rec.Body.String())
	}
	if rec.Code != http.StatusForbidden || env.Error.Code != "DEMO_ACCOUNT" {
		t.Fatalf("= %d %s, se esperaba 403 DEMO_ACCOUNT", rec.Code, env.Error.Code)
	}
}
