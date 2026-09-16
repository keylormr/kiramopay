package cards_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kiramopay/backend/internal/cards"
	"github.com/kiramopay/backend/internal/middleware"
	"github.com/kiramopay/backend/internal/plans"
	"github.com/kiramopay/backend/internal/testutil"
)

// Topes de tarjetas por plan (decision del dueno del 13-09-2026): 1 / 3 / 5
// activas o congeladas. El tope solo frena la creacion.

func nuevaTarjeta(ctx context.Context, svc *cards.Service, user string) (*cards.VirtualCard, error) {
	return svc.CreateCard(ctx, user, "TEST USER", &cards.CreateCardRequest{})
}

func fijarPlanDe(t *testing.T, pool *pgxpool.Pool, user, plan string) {
	t.Helper()
	if _, err := pool.Exec(context.Background(),
		`UPDATE users SET plan = $2 WHERE id = $1::uuid`, user, plan); err != nil {
		t.Fatalf("fijar plan %s: %v", plan, err)
	}
}

func esperarTopeDeTarjetas(t *testing.T, err error, plan string, limite, actuales int) {
	t.Helper()
	var tope *plans.TopeAlcanzadoError
	if !errors.As(err, &tope) {
		t.Fatalf("error = %v, se esperaba el tope del plan", err)
	}
	if tope.Plan != plan || tope.Limite != limite || tope.Actuales != actuales {
		t.Fatalf("tope = %+v, se esperaba plan=%s limite=%d actuales=%d", tope, plan, limite, actuales)
	}
}

func TestTopeTarjetas_LaCongeladaOcupaLugarYLaCanceladaNo(t *testing.T) {
	pool := testutil.TestDB(t)
	uno := testutil.SeedTestUser(t, pool, "702650930", "dummy")
	svc := cards.NewService(cards.NewRepository(pool))
	ctx := context.Background()

	// Estas no ocupan lugar: cancelada, vencida y reemplazada (migracion 063).
	insertarTarjeta(t, pool, uno, cards.MarcaKiramoPay, "cancelled", "1001")
	insertarTarjeta(t, pool, uno, cards.MarcaKiramoPay, "expired", "1002")
	insertarTarjeta(t, pool, uno, "visa", "replaced", "1003")

	primera, err := nuevaTarjeta(ctx, svc, uno)
	if err != nil {
		t.Fatalf("primera tarjeta del plan gratuito: %v", err)
	}
	_, err = nuevaTarjeta(ctx, svc, uno)
	esperarTopeDeTarjetas(t, err, "free", 1, 1)

	if err := svc.FreezeCard(ctx, primera.ID, uno, true); err != nil {
		t.Fatalf("congelar: %v", err)
	}
	_, err = nuevaTarjeta(ctx, svc, uno)
	esperarTopeDeTarjetas(t, err, "free", 1, 1)

	if err := svc.CancelCard(ctx, primera.ID, uno); err != nil {
		t.Fatalf("cancelar: %v", err)
	}
	if _, err := nuevaTarjeta(ctx, svc, uno); err != nil {
		t.Fatalf("con la anterior cancelada debe poder crear otra: %v", err)
	}
}

func TestTopeTarjetas_QuienYaTieneMasLasConserva(t *testing.T) {
	pool := testutil.TestDB(t)
	uno := testutil.SeedTestUser(t, pool, "702650930", "dummy")
	svc := cards.NewService(cards.NewRepository(pool))
	ctx := context.Background()

	insertarTarjeta(t, pool, uno, cards.MarcaKiramoPay, "active", "2001")
	insertarTarjeta(t, pool, uno, cards.MarcaKiramoPay, "active", "2002")
	insertarTarjeta(t, pool, uno, cards.MarcaKiramoPay, "frozen", "2003")
	insertarTarjeta(t, pool, uno, cards.MarcaKiramoPay, "active", "2004")

	_, err := nuevaTarjeta(ctx, svc, uno)
	esperarTopeDeTarjetas(t, err, "free", 1, 4)

	lista, err := svc.GetCards(ctx, uno)
	if err != nil || len(lista) != 4 {
		t.Fatalf("tarjetas = %d (err %v), se esperaban las 4: el tope no quita nada", len(lista), err)
	}
}

func TestTopeTarjetas_CadaPlanConSuTope(t *testing.T) {
	pool := testutil.TestDB(t)
	uno := testutil.SeedTestUser(t, pool, "702650930", "dummy")
	svc := cards.NewService(cards.NewRepository(pool))
	ctx := context.Background()

	fijarPlanDe(t, pool, uno, "plus")
	for i := 0; i < 3; i++ {
		if _, err := nuevaTarjeta(ctx, svc, uno); err != nil {
			t.Fatalf("plus, tarjeta %d: %v", i+1, err)
		}
	}
	_, err := nuevaTarjeta(ctx, svc, uno)
	esperarTopeDeTarjetas(t, err, "plus", 3, 3)

	fijarPlanDe(t, pool, uno, "pro")
	for i := 0; i < 2; i++ {
		if _, err := nuevaTarjeta(ctx, svc, uno); err != nil {
			t.Fatalf("pro, tarjeta %d: %v", 4+i, err)
		}
	}
	_, err = nuevaTarjeta(ctx, svc, uno)
	esperarTopeDeTarjetas(t, err, "pro", 5, 5)
}

func TestTopeTarjetas_CreacionesSimultaneasNoPasanElTope(t *testing.T) {
	pool := testutil.TestDB(t)
	uno := testutil.SeedTestUser(t, pool, "702650930", "dummy")
	svc := cards.NewService(cards.NewRepository(pool))
	ctx := context.Background()

	const intentos = 6
	errs := make([]error, intentos)
	arranque := make(chan struct{})
	var wg sync.WaitGroup
	for i := range errs {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-arranque
			_, errs[i] = nuevaTarjeta(ctx, svc, uno)
		}(i)
	}
	close(arranque)
	wg.Wait()

	creadas := 0
	for i, err := range errs {
		var tope *plans.TopeAlcanzadoError
		switch {
		case err == nil:
			creadas++
		case errors.As(err, &tope):
		default:
			t.Fatalf("intento %d: error inesperado: %v", i, err)
		}
	}
	if creadas != 1 {
		t.Fatalf("creadas = %d, se esperaba 1", creadas)
	}
	var n int
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM virtual_cards WHERE user_id = $1::uuid AND status IN ('active', 'frozen')`,
		uno).Scan(&n); err != nil {
		t.Fatalf("contar: %v", err)
	}
	if n != 1 {
		t.Fatalf("tarjetas activas en la base = %d, se esperaba 1", n)
	}
}

func TestTopeTarjetas_ElHandlerResponde409ConDetalle(t *testing.T) {
	pool := testutil.TestDB(t)
	uno := testutil.SeedTestUser(t, pool, "702650930", "dummy")
	svc := cards.NewService(cards.NewRepository(pool))
	if _, err := nuevaTarjeta(context.Background(), svc, uno); err != nil {
		t.Fatalf("primera tarjeta: %v", err)
	}

	r := chi.NewRouter()
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			next.ServeHTTP(w, req.WithContext(context.WithValue(req.Context(), middleware.UserIDKey, uno)))
		})
	})
	r.Post("/cards", cards.NewHandler(svc).CreateCard)

	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/cards", strings.NewReader(`{}`)))

	if rec.Code != http.StatusConflict {
		t.Fatalf("codigo %d, se esperaba 409: %s", rec.Code, rec.Body.String())
	}
	var body struct {
		Error struct {
			Code    string `json:"code"`
			Details struct {
				Plan     string `json:"plan"`
				Limite   int    `json:"limite"`
				Actuales int    `json:"actuales"`
			} `json:"details"`
		} `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("no es JSON: %s", rec.Body.String())
	}
	d := body.Error.Details
	if body.Error.Code != "CARD_LIMIT" || d.Plan != "free" || d.Limite != 1 || d.Actuales != 1 {
		t.Fatalf("respuesta inesperada: %s", rec.Body.String())
	}
}
