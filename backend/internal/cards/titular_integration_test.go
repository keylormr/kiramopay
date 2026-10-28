package cards_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kiramopay/backend/internal/cards"
	"github.com/kiramopay/backend/internal/middleware"
	"github.com/kiramopay/backend/internal/testutil"
	"github.com/kiramopay/backend/internal/user"
)

// El titular de la tarjeta salia "Titular KiramoPay" para todos: el handler
// pasaba el literal con un TODO. Ahora es el nombre de la persona.

// nombreDelPerfil es el buscador que cablea main: el nombre y el apellido del
// perfil.
func nombreDelPerfil(pool *pgxpool.Pool) cards.BuscadorDeNombre {
	repo := user.NewRepository(pool)
	return func(ctx context.Context, id string) (string, error) {
		u, err := repo.FindByID(ctx, id)
		if err != nil {
			return "", err
		}
		return u.FirstName + " " + u.LastName, nil
	}
}

func enrutar(h *cards.Handler, userID string) http.Handler {
	r := chi.NewRouter()
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			next.ServeHTTP(w, req.WithContext(context.WithValue(req.Context(), middleware.UserIDKey, userID)))
		})
	})
	r.Post("/cards", h.CreateCard)
	return r
}

func TestCrearTarjeta_ElTitularEsLaPersona(t *testing.T) {
	pool := testutil.TestDB(t)
	uno := testutil.SeedTestUser(t, pool, "702650930", "dummy") // se llama "Test User"
	h := cards.NewHandler(cards.NewService(cards.NewRepository(pool))).ConNombreDe(nombreDelPerfil(pool))

	rec := httptest.NewRecorder()
	enrutar(h, uno).ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/cards", strings.NewReader(`{}`)))

	if rec.Code != http.StatusCreated {
		t.Fatalf("codigo %d, se esperaba 201: %s", rec.Code, rec.Body.String())
	}
	var body struct {
		Data struct {
			CardholderName string `json:"cardholder_name"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("no es JSON: %s", rec.Body.String())
	}
	if body.Data.CardholderName != "Test User" {
		t.Fatalf("titular = %q, se esperaba el nombre de la persona", body.Data.CardholderName)
	}

	var guardado string
	if err := pool.QueryRow(context.Background(),
		`SELECT cardholder_name FROM virtual_cards WHERE user_id = $1::uuid`, uno).Scan(&guardado); err != nil {
		t.Fatalf("leer la tarjeta: %v", err)
	}
	if guardado != "Test User" {
		t.Fatalf("titular guardado = %q", guardado)
	}
}

func TestCrearTarjeta_UnaMonedaQueLaAppNoManejaEsUn400(t *testing.T) {
	pool := testutil.TestDB(t)
	uno := testutil.SeedTestUser(t, pool, "702650930", "dummy")
	h := cards.NewHandler(cards.NewService(cards.NewRepository(pool))).ConNombreDe(nombreDelPerfil(pool))

	rec := httptest.NewRecorder()
	enrutar(h, uno).ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/cards", strings.NewReader(`{"currency":"EUR"}`)))

	if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "INVALID_CURRENCY") {
		t.Fatalf("respuesta inesperada: %d %s", rec.Code, rec.Body.String())
	}
	var n int
	if err := pool.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM virtual_cards WHERE user_id = $1::uuid`, uno).Scan(&n); err != nil {
		t.Fatalf("contar: %v", err)
	}
	if n != 0 {
		t.Fatalf("se creo una tarjeta con una moneda invalida: %d", n)
	}
}

// ── Migracion 086: las tarjetas que ya salieron con el rotulo generico ──────

func correr086(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	sql, err := os.ReadFile("../../migrations/086_titular_de_tarjetas.sql")
	if err != nil {
		t.Fatalf("leer migracion: %v", err)
	}
	if _, err := pool.Exec(context.Background(), string(sql)); err != nil {
		t.Fatalf("correr migracion: %v", err)
	}
}

func titularDe(t *testing.T, pool *pgxpool.Pool, cardID string) string {
	t.Helper()
	var n string
	if err := pool.QueryRow(context.Background(),
		`SELECT cardholder_name FROM virtual_cards WHERE id = $1::uuid`, cardID).Scan(&n); err != nil {
		t.Fatalf("leer titular: %v", err)
	}
	return n
}

func TestMigracion086_LasTarjetasConElRotuloGenericoPasanAlNombreDeLaPersona(t *testing.T) {
	pool := testutil.TestDB(t)
	uno := testutil.SeedTestUser(t, pool, "702650930", "dummy") // "Test User"
	ctx := context.Background()

	generica := insertarTarjeta(t, pool, uno, cards.MarcaKiramoPay, "active", "2001")
	congelada := insertarTarjeta(t, pool, uno, cards.MarcaKiramoPay, "frozen", "2002")
	propia := insertarTarjeta(t, pool, uno, cards.MarcaKiramoPay, "active", "2003")
	for _, id := range []string{generica, congelada} {
		if _, err := pool.Exec(ctx,
			`UPDATE virtual_cards SET cardholder_name = 'Titular KiramoPay' WHERE id = $1::uuid`, id); err != nil {
			t.Fatalf("dejar el rotulo viejo: %v", err)
		}
	}
	if _, err := pool.Exec(ctx,
		`UPDATE virtual_cards SET cardholder_name = 'NOMBRE ESCRITO A MANO' WHERE id = $1::uuid`, propia); err != nil {
		t.Fatalf("dejar un titular distinto: %v", err)
	}

	correr086(t, pool)

	for _, id := range []string{generica, congelada} {
		if got := titularDe(t, pool, id); got != "Test User" {
			t.Fatalf("titular = %q, se esperaba el nombre de la persona", got)
		}
	}
	if got := titularDe(t, pool, propia); got != "NOMBRE ESCRITO A MANO" {
		t.Fatalf("la migracion piso un titular que no era el generico: %q", got)
	}
}

func TestMigracion086_SePuedeCorrerDosVeces(t *testing.T) {
	pool := testutil.TestDB(t)
	uno := testutil.SeedTestUser(t, pool, "702650930", "dummy")
	id := insertarTarjeta(t, pool, uno, cards.MarcaKiramoPay, "active", "2004")
	if _, err := pool.Exec(context.Background(),
		`UPDATE virtual_cards SET cardholder_name = 'Titular KiramoPay' WHERE id = $1::uuid`, id); err != nil {
		t.Fatalf("dejar el rotulo viejo: %v", err)
	}

	correr086(t, pool)
	correr086(t, pool)

	if got := titularDe(t, pool, id); got != "Test User" {
		t.Fatalf("titular = %q", got)
	}
}
