package notification_test

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/kiramopay/backend/internal/testutil"
)

// La campana mostraba los avisos tal como se guardaron: los anteriores a la
// migracion 074 estan en espanol aunque la persona use la app en ingles. La
// lista se pide en el idioma de la pantalla (?lang=) y el servidor reescribe
// los avisos que reconoce, SIN tocar lo guardado.

type aviso struct{ Title, Body string }

func sembrarAviso(t *testing.T, pool *pgxpool.Pool, userID, titulo, cuerpo string) {
	t.Helper()
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO notification_history (id, user_id, title, body, type) VALUES ($1, $2, $3, $4, 'transaction')`,
		uuid.NewString(), userID, titulo, cuerpo); err != nil {
		t.Fatalf("sembrar aviso: %v", err)
	}
}

func listaPedida(t *testing.T, pool *pgxpool.Pool, userID, consulta string) []aviso {
	t.Helper()
	rec := comoUsuario(rutasDelHistorial(pool), userID, http.MethodGet, "/api/v1/notifications"+consulta)
	if rec.Code != http.StatusOK {
		t.Fatalf("listar%s: %d %s", consulta, rec.Code, rec.Body.String())
	}
	var sobre struct {
		Data []aviso `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &sobre); err != nil {
		t.Fatalf("la lista no es JSON: %v: %s", err, rec.Body.String())
	}
	return sobre.Data
}

func guardado(t *testing.T, pool *pgxpool.Pool, userID string) map[string]string {
	t.Helper()
	rows, err := pool.Query(context.Background(),
		`SELECT title, body FROM notification_history WHERE user_id = $1::uuid`, userID)
	if err != nil {
		t.Fatalf("leer lo guardado: %v", err)
	}
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var titulo, cuerpo string
		if err := rows.Scan(&titulo, &cuerpo); err != nil {
			t.Fatal(err)
		}
		out[titulo] = cuerpo
	}
	return out
}

func TestListaDeAvisos_EnElIdiomaDeLaPantalla(t *testing.T) {
	pool := testutil.TestDB(t)
	uid := testutil.SeedTestUser(t, pool, "702650930", "hash-de-prueba")
	sembrarAviso(t, pool, uid, "SINPE recibido", "Recibiste ₡1500.00 por SINPE Móvil")
	sembrarAviso(t, pool, uid, "Bienvenido a KiramoPay", "Texto que el catalogo no conoce")

	lista := listaPedida(t, pool, uid, "?lang=en")
	vistos := map[string]string{}
	for _, a := range lista {
		vistos[a.Title] = a.Body
	}
	if got := vistos["SINPE received"]; got != "You received ₡1500.00 via SINPE Móvil" {
		t.Fatalf("el aviso viejo salio como %q, se esperaba en ingles (lista: %v)", got, lista)
	}
	if got, ok := vistos["Bienvenido a KiramoPay"]; !ok || got != "Texto que el catalogo no conoce" {
		t.Fatalf("el aviso desconocido tenia que salir tal cual (lista: %v)", lista)
	}
}

func TestListaDeAvisos_SinIdiomaOConUnoQueNoExisteSaleComoSeGuardo(t *testing.T) {
	pool := testutil.TestDB(t)
	uid := testutil.SeedTestUser(t, pool, "702650930", "hash-de-prueba")
	sembrarAviso(t, pool, uid, "SINPE recibido", "Recibiste ₡1500.00 por SINPE Móvil")

	for _, consulta := range []string{"", "?lang=", "?lang=xx", "?lang=EN", "?lang=en%27%3B--"} {
		lista := listaPedida(t, pool, uid, consulta)
		if len(lista) != 1 || lista[0].Title != "SINPE recibido" || lista[0].Body != "Recibiste ₡1500.00 por SINPE Móvil" {
			t.Errorf("%q: la lista salio como %v, se esperaba lo guardado", consulta, lista)
		}
	}
}

// Es una vista: lo guardado no cambia. Quitar acceso o cambiar la forma de
// mostrar un dato no es reescribir el registro.
func TestListaDeAvisos_NoReescribeLoGuardado(t *testing.T) {
	pool := testutil.TestDB(t)
	uid := testutil.SeedTestUser(t, pool, "702650930", "hash-de-prueba")
	sembrarAviso(t, pool, uid, "SINPE recibido", "Recibiste ₡1500.00 por SINPE Móvil")
	sembrarAviso(t, pool, uid, "Se te pagó un escrow", "Bicicleta: ₡25,000.00. El comprador no reclamó dentro del plazo.")

	for _, consulta := range []string{"?lang=en", "?lang=ja", "?lang=fr"} {
		listaPedida(t, pool, uid, consulta)
	}

	quedo := guardado(t, pool, uid)
	if len(quedo) != 2 ||
		quedo["SINPE recibido"] != "Recibiste ₡1500.00 por SINPE Móvil" ||
		quedo["Se te pagó un escrow"] != "Bicicleta: ₡25,000.00. El comprador no reclamó dentro del plazo." {
		t.Fatalf("lo guardado cambio: %v", quedo)
	}
}
