package accountdeletion

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/kiramopay/backend/internal/testutil"
)

func TestHandler_PreflightDiceSiFaltaCorreoParaLaRespuesta(t *testing.T) {
	pool := testutil.TestDB(t)
	a := sembrar(t, pool)
	sinCorreo(t, pool, a.ID)
	h := NewHandler(nuevoServicio(pool, nil), nil)

	rec, env := llamar(t, router(h, a.ID), "GET", "/users/me/delete-account/preflight", "")
	if rec.Code != 200 {
		t.Fatalf("%d %s", rec.Code, rec.Body.String())
	}
	var pf struct {
		Pide *bool `json:"requires_response_email"`
	}
	_ = json.Unmarshal(env.Data, &pf)
	if pf.Pide == nil || !*pf.Pide {
		t.Errorf("sin correo, el preflight debe pedirlo: %s", env.Data)
	}
}

func TestHandler_EliminarConElCorreoParaLaRespuesta(t *testing.T) {
	pool := testutil.TestDB(t)
	a := sembrar(t, pool)
	sinCorreo(t, pool, a.ID)
	srv := router(NewHandler(nuevoServicio(pool, nil), nil), a.ID)
	base := `"password":"` + claveDePrueba + `","accept_terms":true`

	if rec, env := llamar(t, srv, "POST", "/users/me/delete-account", `{`+base+`}`); rec.Code != 400 || env.Error == nil || env.Error.Code != "RESPONSE_EMAIL_REQUIRED" {
		t.Errorf("sin correo para la respuesta: %d %s", rec.Code, rec.Body.String())
	}
	if rec, env := llamar(t, srv, "POST", "/users/me/delete-account", `{`+base+`,"response_email":"no-es-correo"}`); rec.Code != 400 || env.Error == nil || env.Error.Code != "RESPONSE_EMAIL_INVALID" {
		t.Errorf("con un correo invalido: %d %s", rec.Code, rec.Body.String())
	}
	rec, env := llamar(t, srv, "POST", "/users/me/delete-account", `{`+base+`,"response_email":"respuesta@ejemplo.test","response_email_confirmation":"respuesta@ejemplo.test"}`)
	if rec.Code != 200 {
		t.Fatalf("con el correo: %d %s", rec.Code, rec.Body.String())
	}
	var s struct {
		Dia30   time.Time `json:"deletion_due_at"`
		Guardar time.Time `json:"retained_until"`
	}
	_ = json.Unmarshal(env.Data, &s)
	if s.Dia30.IsZero() || !s.Guardar.Equal(s.Dia30.AddDate(5, 0, 0)) {
		t.Errorf("la respuesta debe traer hasta cuando se conserva: %s", env.Data)
	}
}

func TestHandler_VerificarDevuelveLaRespuesta(t *testing.T) {
	pool := testutil.TestDB(t)
	a := sembrar(t, pool)
	correo := nuevoCorreo()
	srv := router(NewHandler(nuevoServicio(pool, &Options{Email: correo}), nil), "")

	if rec, _ := llamar(t, srv, "POST", "/public/account-deletion-requests", `{"contact":"`+a.Correo+`","accept_terms":true}`); rec.Code != 202 {
		t.Fatalf("solicitar: %d", rec.Code)
	}
	codigo := codigoDe(t, esperar(t, correo.ch))
	rec, env := llamar(t, srv, "POST", "/public/account-deletion-requests/verify", `{"contact":"`+a.Correo+`","code":"`+codigo+`"}`)
	if rec.Code != 200 {
		t.Fatalf("verificar: %d %s", rec.Code, rec.Body.String())
	}
	var v struct {
		Status  string     `json:"status"`
		Outcome string     `json:"outcome"`
		Dia30   *time.Time `json:"deletion_due_at"`
		Guardar *time.Time `json:"retained_until"`
	}
	_ = json.Unmarshal(env.Data, &v)
	if v.Status != "verified" || v.Outcome != "scheduled" || v.Dia30 == nil || v.Guardar == nil || !v.Guardar.Equal(v.Dia30.AddDate(5, 0, 0)) {
		t.Errorf("la pagina debe recibir la respuesta: %s", env.Data)
	}
	if rec.Header().Get("Cache-Control") != "no-store" {
		t.Error("la respuesta no debe cachearse")
	}
}

func TestHandler_AdminRespuestasSinEntregar(t *testing.T) {
	pool := testutil.TestDB(t)
	a := sembrar(t, pool)
	sinCorreo(t, pool, a.ID)
	admin := administrador(t, pool)
	svc := nuevoServicio(pool, nil)
	srv := router(NewHandler(svc, nil), admin.ID)

	rec, env := llamar(t, srv, "GET", "/admin/account-deletion-responses", "")
	if rec.Code != 200 || string(env.Data) != "[]" {
		t.Fatalf("sin pendientes debe ser []: %d %s", rec.Code, rec.Body.String())
	}

	pedir(t, svc, a.ID)
	if _, err := svc.EntregarRespuestas(context.Background(), time.Now(), 100); err != nil {
		t.Fatal(err)
	}
	rec, env = llamar(t, srv, "GET", "/admin/account-deletion-responses", "")
	var lista []struct {
		ID      string          `json:"id"`
		Kind    string          `json:"kind"`
		Reason  string          `json:"reason"`
		Account json.RawMessage `json:"account"`
	}
	_ = json.Unmarshal(env.Data, &lista)
	if rec.Code != 200 || len(lista) != 1 || lista[0].Kind != "scheduled" || lista[0].Reason != "no_channel" || len(lista[0].Account) < 3 {
		t.Fatalf("el panel: %d %s", rec.Code, rec.Body.String())
	}
	ruta := "/admin/account-deletion-responses/" + lista[0].ID + "/delivered"

	if rec, env := llamar(t, srv, "POST", ruta, `{"note":"  "}`); rec.Code != 400 || env.Error == nil || env.Error.Code != "NOTE_REQUIRED" {
		t.Errorf("sin nota: %d %s", rec.Code, rec.Body.String())
	}
	if rec, _ := llamar(t, srv, "POST", ruta, `{"note":"Se la leimos por telefono"}`); rec.Code != 204 {
		t.Errorf("marcarla entregada: %d %s", rec.Code, rec.Body.String())
	}
	if rec, env := llamar(t, srv, "POST", ruta, `{"note":"otra vez"}`); rec.Code != 409 || env.Error == nil || env.Error.Code != "NOT_PENDING" {
		t.Errorf("marcarla dos veces: %d %s", rec.Code, rec.Body.String())
	}
	for _, otra := range []string{"no-es-uuid", uuid.NewString()} {
		if rec, _ := llamar(t, srv, "POST", "/admin/account-deletion-responses/"+otra+"/delivered", `{"note":"x"}`); rec.Code != 404 {
			t.Errorf("%s: %d", otra, rec.Code)
		}
	}
}
