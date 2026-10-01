package notification_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/kiramopay/backend/internal/contract"
	"github.com/kiramopay/backend/internal/middleware"
	"github.com/kiramopay/backend/internal/notification"
	"github.com/kiramopay/backend/internal/testutil"
)

// Borrar una notificacion desde la pantalla no borraba nada: la ruta no
// existia, la pantalla la quitaba de la lista, se tragaba el error y la
// notificacion volvia en la siguiente carga. Pedido del dueno: que la persona
// deje de verla, pero que el registro quede ("que nosotros tengamos el
// respaldo del dato aunque el usuario no lo vea"). Quitar acceso no es borrar
// registros.

// rutasDelHistorial arma el historial como lo monta main.go, dentro de /api/v1.
func rutasDelHistorial(pool *pgxpool.Pool) http.Handler {
	h := notification.NewHandler(notification.NewService(notification.NewRepository(pool), "", ""))
	r := chi.NewRouter()
	r.Route("/api/v1", func(r chi.Router) { notification.MontarHistorial(r, h) })
	return r
}

func comoUsuario(ruta http.Handler, userID, metodo, url string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(metodo, url, nil)
	req = req.WithContext(context.WithValue(req.Context(), middleware.UserIDKey, userID))
	rec := httptest.NewRecorder()
	ruta.ServeHTTP(rec, req)
	return rec
}

func sembrarNotificacion(t *testing.T, pool *pgxpool.Pool, userID, titulo string) string {
	t.Helper()
	id := uuid.NewString()
	if err := notification.NewRepository(pool).InsertNotification(context.Background(), &notification.NotificationRecord{
		ID: id, UserID: userID, Title: titulo, Body: "cuerpo", Type: "system",
	}); err != nil {
		t.Fatalf("sembrar notificacion: %v", err)
	}
	return id
}

func titulosVisibles(t *testing.T, ruta http.Handler, userID string) []string {
	t.Helper()
	rec := comoUsuario(ruta, userID, http.MethodGet, "/api/v1/notifications")
	if rec.Code != http.StatusOK {
		t.Fatalf("listar: %d %s", rec.Code, rec.Body.String())
	}
	var sobre struct {
		Data []notification.NotificationRecord `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &sobre); err != nil {
		t.Fatalf("lista no es JSON: %v: %s", err, rec.Body.String())
	}
	titulos := []string{}
	for _, n := range sobre.Data {
		titulos = append(titulos, n.Title)
	}
	return titulos
}

func codigoDelRechazo(t *testing.T, rec *httptest.ResponseRecorder) string {
	t.Helper()
	var sobre struct {
		Error *struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &sobre); err != nil || sobre.Error == nil {
		t.Fatalf("respuesta %d sin error en JSON: %s", rec.Code, rec.Body.String())
	}
	return sobre.Error.Code
}

// cumpleLaSpec valida el cuerpo contra lo que documenta openapi.yaml para esa
// ruta y ese estado: un estado que la spec no documenta tambien falla.
func cumpleLaSpec(t *testing.T, url string, rec *httptest.ResponseRecorder) {
	t.Helper()
	doc, err := contract.LoadSpec("../../docs/openapi.yaml")
	if err != nil {
		t.Fatalf("spec: %v", err)
	}
	router, err := contract.NewRouter(doc)
	if err != nil {
		t.Fatalf("router de la spec: %v", err)
	}
	if err := contract.ValidateResponseBody(router, http.MethodDelete, "http://localhost:8080"+url, rec.Code, rec.Body.Bytes()); err != nil {
		t.Fatalf("DELETE %s %d no cumple la spec: %v", url, rec.Code, err)
	}
}

func momentoEnQueSeOculto(t *testing.T, pool *pgxpool.Pool, id string) *time.Time {
	t.Helper()
	var oculta *time.Time
	if err := pool.QueryRow(context.Background(),
		`SELECT hidden_at FROM notification_history WHERE id = $1::uuid`, id).Scan(&oculta); err != nil {
		t.Fatalf("leer la fila: %v", err)
	}
	return oculta
}

func TestOcultarNotificacion_LaPersonaDejaDeVerlaYElRegistroQueda(t *testing.T) {
	pool := testutil.TestDB(t)
	userID := testutil.SeedTestUser(t, pool, "702650930", "hash-de-prueba")
	ruta := rutasDelHistorial(pool)
	primera := sembrarNotificacion(t, pool, userID, "Primera")
	sembrarNotificacion(t, pool, userID, "Segunda")

	rec := comoUsuario(ruta, userID, http.MethodDelete, "/api/v1/notifications/"+primera)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("ocultar respondio %d, esperaba 204: %s", rec.Code, rec.Body.String())
	}

	if got := titulosVisibles(t, ruta, userID); len(got) != 1 || got[0] != "Segunda" {
		t.Fatalf("la lista muestra %v, esperaba solo [Segunda]", got)
	}
	// El registro sigue en la base, con el momento en que se oculto.
	if momentoEnQueSeOculto(t, pool, primera) == nil {
		t.Fatal("la fila quedo sin marca de ocultamiento")
	}
}

func TestOcultarNotificacion_LaDeOtraPersonaNoSeToca(t *testing.T) {
	pool := testutil.TestDB(t)
	titular := testutil.SeedTestUser(t, pool, "702650930", "hash-de-prueba")
	otra := testutil.SeedTestUser2(t, pool)
	ruta := rutasDelHistorial(pool)
	ajena := sembrarNotificacion(t, pool, titular, "De la primera cuenta")

	url := "/api/v1/notifications/" + ajena
	rec := comoUsuario(ruta, otra, http.MethodDelete, url)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("ocultar una ajena respondio %d, esperaba 404: %s", rec.Code, rec.Body.String())
	}
	if c := codigoDelRechazo(t, rec); c != "NOTIFICATION_NOT_FOUND" {
		t.Fatalf("codigo %q, esperaba NOTIFICATION_NOT_FOUND", c)
	}
	cumpleLaSpec(t, url, rec)

	if got := titulosVisibles(t, ruta, titular); len(got) != 1 {
		t.Fatalf("la cuenta titular ve %v; la otra cuenta le oculto su notificacion", got)
	}
	if momentoEnQueSeOculto(t, pool, ajena) != nil {
		t.Fatal("la fila de la otra cuenta quedo marcada como oculta")
	}
}

func TestOcultarNotificacion_UnIdQueNoEsUnUUID(t *testing.T) {
	pool := testutil.TestDB(t)
	userID := testutil.SeedTestUser(t, pool, "702650930", "hash-de-prueba")
	ruta := rutasDelHistorial(pool)

	url := "/api/v1/notifications/no-es-un-id"
	rec := comoUsuario(ruta, userID, http.MethodDelete, url)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("respondio %d, esperaba 400: %s", rec.Code, rec.Body.String())
	}
	if c := codigoDelRechazo(t, rec); c != "INVALID_ID" {
		t.Fatalf("codigo %q, esperaba INVALID_ID", c)
	}
	cumpleLaSpec(t, url, rec)
}

// Ocultarla otra vez (doble toque, reintento sin red) no falla ni pisa el
// momento en que se oculto por primera vez.
func TestOcultarNotificacion_DosVecesConservaLaPrimeraMarca(t *testing.T) {
	pool := testutil.TestDB(t)
	userID := testutil.SeedTestUser(t, pool, "702650930", "hash-de-prueba")
	ruta := rutasDelHistorial(pool)
	id := sembrarNotificacion(t, pool, userID, "Repetida")
	url := "/api/v1/notifications/" + id

	if rec := comoUsuario(ruta, userID, http.MethodDelete, url); rec.Code != http.StatusNoContent {
		t.Fatalf("primera vez: %d %s", rec.Code, rec.Body.String())
	}
	primera := momentoEnQueSeOculto(t, pool, id)
	if primera == nil {
		t.Fatal("la primera vez no la marco")
	}
	if rec := comoUsuario(ruta, userID, http.MethodDelete, url); rec.Code != http.StatusNoContent {
		t.Fatalf("segunda vez: %d %s", rec.Code, rec.Body.String())
	}
	if segunda := momentoEnQueSeOculto(t, pool, id); segunda == nil || !segunda.Equal(*primera) {
		t.Fatalf("la segunda vez cambio la marca: %v -> %v", primera, segunda)
	}
}
