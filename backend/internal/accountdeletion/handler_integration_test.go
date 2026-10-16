package accountdeletion

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/kiramopay/backend/internal/middleware"
	"github.com/kiramopay/backend/internal/testutil"
)

// router monta las rutas igual que main.go. Como no hay JWT en la prueba, un
// middleware minimo pone el id de la persona donde lo pondria el de autenticacion.
func router(h *Handler, userID string) http.Handler {
	r := chi.NewRouter()
	r.Group(func(r chi.Router) {
		r.Use(func(next http.Handler) http.Handler {
			return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
				if userID != "" {
					req = req.WithContext(context.WithValue(req.Context(), middleware.UserIDKey, userID))
				}
				next.ServeHTTP(w, req)
			})
		})
		r.Get("/users/me/delete-account/preflight", h.Preflight)
		r.Post("/users/me/delete-account", h.Eliminar)
		r.Post("/admin/account-deletion-requests/{id}/process", h.Procesar)
		r.Post("/admin/account-deletion-requests/{id}/reject", h.Rechazar)
	})
	r.Post("/public/account-deletion-requests", h.Solicitar)
	r.Post("/public/account-deletion-requests/verify", h.Verificar)
	return r
}

type sobre struct {
	Success bool            `json:"success"`
	Data    json.RawMessage `json:"data"`
	Error   *struct {
		Code    string          `json:"code"`
		Message string          `json:"message"`
		Details json.RawMessage `json:"details"`
	} `json:"error"`
}

func llamar(t *testing.T, h http.Handler, metodo, ruta, cuerpo string) (*httptest.ResponseRecorder, sobre) {
	t.Helper()
	req := httptest.NewRequest(metodo, ruta, strings.NewReader(cuerpo))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	var s sobre
	if rec.Body.Len() > 0 {
		if err := json.Unmarshal(rec.Body.Bytes(), &s); err != nil {
			t.Fatalf("la respuesta no es JSON: %s", rec.Body.String())
		}
	}
	return rec, s
}

func TestHandler_Preflight(t *testing.T) {
	pool := testutil.TestDB(t)
	a := sembrar(t, pool)
	h := NewHandler(nuevoServicio(pool, nil), nil)

	rec, env := llamar(t, router(h, a.ID), "GET", "/users/me/delete-account/preflight", "")
	if rec.Code != 200 || !env.Success {
		t.Fatalf("%d %s", rec.Code, rec.Body.String())
	}
	var pf struct {
		Eligible bool             `json:"eligible"`
		Blockers []map[string]any `json:"blockers"`
	}
	_ = json.Unmarshal(env.Data, &pf)
	if !pf.Eligible || pf.Blockers == nil {
		t.Errorf("la lista de bloqueos debe ser [] y no null: %s", env.Data)
	}
	if rec.Header().Get("Cache-Control") != "no-store" {
		t.Error("el preflight no debe cachearse")
	}

	if rec, _ := llamar(t, router(h, ""), "GET", "/users/me/delete-account/preflight", ""); rec.Code != 401 {
		t.Errorf("sin sesion debia ser 401, fue %d", rec.Code)
	}
}

func TestHandler_Eliminar(t *testing.T) {
	pool := testutil.TestDB(t)
	a := sembrar(t, pool)
	cerrada := false
	h := NewHandler(nuevoServicio(pool, nil), func(w http.ResponseWriter) {
		cerrada = true
		w.Header().Set("Clear-Site-Data", `"cookies", "storage"`)
	})
	srv := router(h, a.ID)

	// Cuerpo invalido
	if rec, env := llamar(t, srv, "POST", "/users/me/delete-account", "{no es json"); rec.Code != 400 || env.Error.Code != "INVALID_BODY" {
		t.Errorf("cuerpo invalido: %d %s", rec.Code, rec.Body.String())
	}
	// Contrasena equivocada
	if rec, env := llamar(t, srv, "POST", "/users/me/delete-account", `{"password":"mala"}`); rec.Code != 400 || env.Error.Code != "CURRENT_PASSWORD_INVALID" {
		t.Errorf("contrasena: %d %s", rec.Code, rec.Body.String())
	}
	if cerrada {
		t.Fatal("se cerro la sesion pese al rechazo")
	}

	// Con saldo: 409 con la lista de lo que hay que resolver
	fondear(t, pool, a.ID, 700)
	rec, env := llamar(t, srv, "POST", "/users/me/delete-account", `{"password":"`+claveDePrueba+`"}`)
	if rec.Code != 409 || env.Error.Code != "DELETION_BLOCKED" {
		t.Fatalf("saldo: %d %s", rec.Code, rec.Body.String())
	}
	var det struct {
		Blockers []Bloqueo `json:"blockers"`
	}
	_ = json.Unmarshal(env.Error.Details, &det)
	if len(det.Blockers) != 1 || det.Blockers[0].Codigo != BloqueoSaldo {
		t.Errorf("detalle del bloqueo: %s", env.Error.Details)
	}
	if cerrada {
		t.Fatal("se cerro la sesion pese al bloqueo")
	}

	// Sin saldo: elimina y le pide al navegador soltar la sesion
	exec(t, pool, `UPDATE wallets SET balance_crc = 0 WHERE user_id = $1::uuid`, a.ID)
	asentar(t, pool, a.ID, "debit", "credit", 700)
	rec, env = llamar(t, srv, "POST", "/users/me/delete-account", `{"password":"`+claveDePrueba+`"}`)
	if rec.Code != 200 || !env.Success {
		t.Fatalf("eliminar: %d %s", rec.Code, rec.Body.String())
	}
	if !cerrada || rec.Header().Get("Clear-Site-Data") == "" {
		t.Error("la respuesta no limpio la sesion del navegador")
	}
	if !cuenta1[bool](t, pool, `SELECT anonymized_at IS NOT NULL FROM users WHERE id = $1::uuid`, a.ID) {
		t.Error("la cuenta no quedo eliminada")
	}
}

func TestHandler_CodigosDeElegibilidad(t *testing.T) {
	pool := testutil.TestDB(t)
	svc := nuevoServicio(pool, nil)
	h := NewHandler(svc, nil)
	cuerpo := `{"password":"` + claveDePrueba + `"}`

	admin := sembrar(t, pool)
	exec(t, pool, `UPDATE users SET role = 'admin' WHERE id = $1::uuid`, admin.ID)
	if rec, env := llamar(t, router(h, admin.ID), "POST", "/users/me/delete-account", cuerpo); rec.Code != 403 || env.Error.Code != "ADMIN_ACCOUNT" {
		t.Errorf("admin: %d %s", rec.Code, rec.Body.String())
	}
	demo := sembrar(t, pool)
	exec(t, pool, `UPDATE users SET demo_login = true WHERE id = $1::uuid`, demo.ID)
	if rec, env := llamar(t, router(h, demo.ID), "POST", "/users/me/delete-account", cuerpo); rec.Code != 403 || env.Error.Code != "DEMO_ACCOUNT" {
		t.Errorf("demo: %d %s", rec.Code, rec.Body.String())
	}
	bloqueada := sembrar(t, pool)
	exec(t, pool, `UPDATE users SET status = 'blocked', blocked_at = NOW(), blocked_reason = 'x' WHERE id = $1::uuid`, bloqueada.ID)
	if rec, env := llamar(t, router(h, bloqueada.ID), "POST", "/users/me/delete-account", cuerpo); rec.Code != 403 || env.Error.Code != "ACCOUNT_NOT_ELIGIBLE" {
		t.Errorf("bloqueada: %d %s", rec.Code, rec.Body.String())
	}
}

func TestHandler_Publico(t *testing.T) {
	pool := testutil.TestDB(t)
	a := sembrar(t, pool)
	correo := nuevoCorreo()
	h := NewHandler(nuevoServicio(pool, &Options{Email: correo}), nil)
	srv := router(h, "")

	// Con cuenta y sin cuenta: la MISMA respuesta.
	rec1, env1 := llamar(t, srv, "POST", "/public/account-deletion-requests", `{"contact":"`+a.Correo+`"}`)
	rec2, env2 := llamar(t, srv, "POST", "/public/account-deletion-requests", `{"contact":"nadie@ejemplo.test"}`)
	if rec1.Code != 202 || rec2.Code != 202 || string(env1.Data) != string(env2.Data) {
		t.Fatalf("respuestas distintas: %d %s / %d %s", rec1.Code, rec1.Body.String(), rec2.Code, rec2.Body.String())
	}
	codigo := codigoDe(t, esperar(t, correo.ch))

	if rec, env := llamar(t, srv, "POST", "/public/account-deletion-requests", `{"contact":"no es un contacto"}`); rec.Code != 400 || env.Error.Code != "INVALID_CONTACT" {
		t.Errorf("contacto invalido: %d %s", rec.Code, rec.Body.String())
	}
	if rec, env := llamar(t, srv, "POST", "/public/account-deletion-requests/verify", `{"contact":"`+a.Correo+`","code":"000000"}`); rec.Code != 400 || env.Error.Code != "INVALID_CODE" {
		t.Errorf("codigo malo: %d %s", rec.Code, rec.Body.String())
	}
	if rec, _ := llamar(t, srv, "POST", "/public/account-deletion-requests/verify", `{"contact":"`+a.Correo+`","code":"`+codigo+`"}`); rec.Code != 200 {
		t.Errorf("codigo bueno: %d %s", rec.Code, rec.Body.String())
	}
}

func TestHandler_Admin_IdMalFormadoEsNotFound(t *testing.T) {
	pool := testutil.TestDB(t)
	admin := sembrar(t, pool)
	srv := router(NewHandler(nuevoServicio(pool, nil), nil), admin.ID)
	for _, ruta := range []string{"/admin/account-deletion-requests/no-es-uuid/process", "/admin/account-deletion-requests/no-es-uuid/reject"} {
		if rec, _ := llamar(t, srv, "POST", ruta, ""); rec.Code != 404 {
			t.Errorf("%s: %d", ruta, rec.Code)
		}
	}
}
