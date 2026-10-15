package user_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/kiramopay/backend/internal/middleware"
	"github.com/kiramopay/backend/internal/testutil"
	"github.com/kiramopay/backend/internal/user"
)

// El servidor no sabia en que idioma usa la app cada persona, asi que todo
// aviso y todo push salia en espanol. La app le dice su idioma con
// PUT /users/me/language y el perfil lo devuelve.

func rutasDelIdioma(pool *pgxpool.Pool) http.Handler {
	h := user.NewHandler(user.NewService(user.NewRepository(pool)))
	r := chi.NewRouter()
	r.Get("/api/v1/users/me", h.GetProfile)
	r.Put("/api/v1/users/me/language", h.SetLanguage)
	return r
}

func pedirComo(ruta http.Handler, userID, metodo, url, cuerpo string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(metodo, url, strings.NewReader(cuerpo))
	req.Header.Set("Content-Type", "application/json")
	req = req.WithContext(context.WithValue(req.Context(), middleware.UserIDKey, userID))
	rec := httptest.NewRecorder()
	ruta.ServeHTTP(rec, req)
	return rec
}

func idiomaDelPerfil(t *testing.T, ruta http.Handler, userID string) string {
	t.Helper()
	rec := pedirComo(ruta, userID, http.MethodGet, "/api/v1/users/me", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("perfil: %d %s", rec.Code, rec.Body.String())
	}
	var env struct {
		Data struct {
			Language *string `json:"language"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("perfil: %v", err)
	}
	if env.Data.Language == nil {
		t.Fatalf("el perfil no trae el idioma: %s", rec.Body.String())
	}
	return *env.Data.Language
}

func TestIdioma_UnaCuentaNuevaEstaEnEspanol(t *testing.T) {
	pool := testutil.TestDB(t)
	uid := testutil.SeedTestUser(t, pool, "702650930", "dummy")
	if got := idiomaDelPerfil(t, rutasDelIdioma(pool), uid); got != "es" {
		t.Fatalf("idioma de una cuenta nueva = %q, se esperaba es", got)
	}
}

func TestIdioma_SeGuardaYElPerfilLoDevuelve(t *testing.T) {
	pool := testutil.TestDB(t)
	uid := testutil.SeedTestUser(t, pool, "702650930", "dummy")
	ruta := rutasDelIdioma(pool)

	for _, idioma := range []string{"en", "zh-cn", "es"} {
		rec := pedirComo(ruta, uid, http.MethodPut, "/api/v1/users/me/language", `{"language":"`+idioma+`"}`)
		if rec.Code != http.StatusNoContent {
			t.Fatalf("guardar %s: %d %s", idioma, rec.Code, rec.Body.String())
		}
		if got := idiomaDelPerfil(t, ruta, uid); got != idioma {
			t.Fatalf("despues de guardar %s el perfil dice %q", idioma, got)
		}
	}
}

// Solo los siete idiomas de la app: cualquier otro valor se rechaza con un
// codigo propio y el guardado no cambia.
func TestIdioma_UnoQueLaAppNoTieneSeRechaza(t *testing.T) {
	pool := testutil.TestDB(t)
	uid := testutil.SeedTestUser(t, pool, "702650930", "dummy")
	ruta := rutasDelIdioma(pool)
	if rec := pedirComo(ruta, uid, http.MethodPut, "/api/v1/users/me/language", `{"language":"en"}`); rec.Code != http.StatusNoContent {
		t.Fatalf("guardar en: %d %s", rec.Code, rec.Body.String())
	}

	for _, cuerpo := range []string{`{"language":"xx"}`, `{"language":""}`, `{"language":"EN"}`, `{}`, `no es json`} {
		rec := pedirComo(ruta, uid, http.MethodPut, "/api/v1/users/me/language", cuerpo)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("%s: %d, se esperaba 400", cuerpo, rec.Code)
		}
		if cuerpo != `no es json` && !strings.Contains(rec.Body.String(), "INVALID_LANGUAGE") {
			t.Fatalf("%s: %s, se esperaba el codigo INVALID_LANGUAGE", cuerpo, rec.Body.String())
		}
	}
	if got := idiomaDelPerfil(t, ruta, uid); got != "en" {
		t.Fatalf("un rechazo cambio el idioma guardado a %q", got)
	}
}

// Las cuentas de demostracion no pueden cambiar sus datos (PATCH /users/me),
// pero el idioma no es un dato de identidad: tambien ellas reciben los avisos.
func TestIdioma_UnaCuentaDeDemostracionTambienLoGuarda(t *testing.T) {
	pool := testutil.TestDB(t)
	uid := testutil.SeedTestUser(t, pool, "702650930", "dummy")
	if _, err := pool.Exec(context.Background(),
		`UPDATE users SET demo_login = true WHERE id = $1::uuid`, uid); err != nil {
		t.Fatalf("marcar demo: %v", err)
	}
	ruta := rutasDelIdioma(pool)
	if rec := pedirComo(ruta, uid, http.MethodPut, "/api/v1/users/me/language", `{"language":"ja"}`); rec.Code != http.StatusNoContent {
		t.Fatalf("guardar ja en una cuenta demo: %d %s", rec.Code, rec.Body.String())
	}
	if got := idiomaDelPerfil(t, ruta, uid); got != "ja" {
		t.Fatalf("idioma de la cuenta demo = %q", got)
	}
}

func TestIdioma_SinSesionEs401(t *testing.T) {
	pool := testutil.TestDB(t)
	rec := pedirComo(rutasDelIdioma(pool), "", http.MethodPut, "/api/v1/users/me/language", `{"language":"en"}`)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("sin sesion: %d, se esperaba 401", rec.Code)
	}
}
