package savings_test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kiramopay/backend/internal/middleware"
	"github.com/kiramopay/backend/internal/plans"
	"github.com/kiramopay/backend/internal/savings"
)

// Topes de metas por plan (decision del dueno del 13-09-2026): 3 / 10 / sin
// tope. El tope solo frena la creacion.

func crearMeta(ctx context.Context, svc *savings.Service, user string) (*savings.Goal, error) {
	return svc.Create(ctx, user, &savings.CreateGoalRequest{Name: "Meta", TargetMinor: 100000, Currency: "CRC"})
}

func contarMetas(t *testing.T, pool *pgxpool.Pool, user string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM savings_goals WHERE user_id = $1::uuid`, user).Scan(&n); err != nil {
		t.Fatalf("contar metas: %v", err)
	}
	return n
}

func fijarPlan(t *testing.T, pool *pgxpool.Pool, user, plan string) {
	t.Helper()
	if _, err := pool.Exec(context.Background(),
		`UPDATE users SET plan = $2 WHERE id = $1::uuid`, user, plan); err != nil {
		t.Fatalf("fijar plan %s: %v", plan, err)
	}
}

func esperarTope(t *testing.T, err error, plan string, limite, actuales int) {
	t.Helper()
	var tope *plans.TopeAlcanzadoError
	if !errors.As(err, &tope) {
		t.Fatalf("error = %v, se esperaba el tope del plan", err)
	}
	if tope.Plan != plan || tope.Limite != limite || tope.Actuales != actuales {
		t.Fatalf("tope = %+v, se esperaba plan=%s limite=%d actuales=%d", tope, plan, limite, actuales)
	}
}

func TestTopeMetas_ElGratuitoCreaTres(t *testing.T) {
	svc, pool, user := setupSavings(t)
	ctx := context.Background()

	for i := 0; i < 3; i++ {
		if _, err := crearMeta(ctx, svc, user); err != nil {
			t.Fatalf("meta %d: %v", i+1, err)
		}
	}
	_, err := crearMeta(ctx, svc, user)
	esperarTope(t, err, "free", 3, 3)
	if n := contarMetas(t, pool, user); n != 3 {
		t.Fatalf("metas = %d, se esperaban 3: el rechazo no debe escribir nada", n)
	}
}

func TestTopeMetas_QuienYaTieneMasLasConserva(t *testing.T) {
	svc, pool, user := setupSavings(t)
	ctx := context.Background()

	// Cinco metas de antes de que existiera el tope.
	for i := 0; i < 5; i++ {
		if _, err := pool.Exec(ctx,
			`INSERT INTO savings_goals (user_id, name, target_minor) VALUES ($1::uuid, $2, 100000)`,
			user, fmt.Sprintf("Vieja %d", i+1)); err != nil {
			t.Fatalf("sembrar meta: %v", err)
		}
	}

	_, err := crearMeta(ctx, svc, user)
	esperarTope(t, err, "free", 3, 5)

	goals, err := svc.List(ctx, user)
	if err != nil || len(goals) != 5 {
		t.Fatalf("metas = %d (err %v), se esperaban las 5: el tope no quita nada", len(goals), err)
	}
	// Y siguen funcionando: se puede guardar en la quinta.
	if _, err := svc.Deposit(ctx, user, goals[4].ID, 1000, ""); err != nil {
		t.Fatalf("depositar en una meta por encima del tope: %v", err)
	}
}

func TestTopeMetas_CadaPlanConSuTope(t *testing.T) {
	svc, pool, user := setupSavings(t)
	ctx := context.Background()

	fijarPlan(t, pool, user, "plus")
	for i := 0; i < 10; i++ {
		if _, err := crearMeta(ctx, svc, user); err != nil {
			t.Fatalf("plus, meta %d: %v", i+1, err)
		}
	}
	_, err := crearMeta(ctx, svc, user)
	esperarTope(t, err, "plus", 10, 10)

	fijarPlan(t, pool, user, "pro")
	for i := 0; i < 3; i++ {
		if _, err := crearMeta(ctx, svc, user); err != nil {
			t.Fatalf("pro no tiene tope, meta %d: %v", 11+i, err)
		}
	}

	// Bajar a gratis no borra nada: solo frena la siguiente.
	fijarPlan(t, pool, user, "free")
	_, err = crearMeta(ctx, svc, user)
	esperarTope(t, err, "free", 3, 13)
	if n := contarMetas(t, pool, user); n != 13 {
		t.Fatalf("metas = %d, se esperaban 13", n)
	}
}

// Sin el bloqueo por persona, ocho creaciones simultaneas cuentan 0, 1 o 2 a
// la vez y dejan mas de 3.
func TestTopeMetas_CreacionesSimultaneasNoPasanElTope(t *testing.T) {
	svc, pool, user := setupSavings(t)
	ctx := context.Background()

	const intentos = 8
	errs := make([]error, intentos)
	arranque := make(chan struct{})
	var wg sync.WaitGroup
	for i := range errs {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-arranque
			_, errs[i] = crearMeta(ctx, svc, user)
		}(i)
	}
	close(arranque)
	wg.Wait()

	creadas, rechazadas := 0, 0
	for i, err := range errs {
		var tope *plans.TopeAlcanzadoError
		switch {
		case err == nil:
			creadas++
		case errors.As(err, &tope):
			rechazadas++
		default:
			t.Fatalf("intento %d: error inesperado: %v", i, err)
		}
	}
	if creadas != 3 || rechazadas != intentos-3 {
		t.Fatalf("creadas=%d rechazadas=%d, se esperaban 3 y %d", creadas, rechazadas, intentos-3)
	}
	if n := contarMetas(t, pool, user); n != 3 {
		t.Fatalf("metas en la base = %d, se esperaban 3", n)
	}
}

func TestTopeMetas_LaConfiguracionManda(t *testing.T) {
	svc, _, user := setupSavings(t)
	ctx := context.Background()
	svc.SetTopes(plans.Topes{Free: 1, Plus: 2, Pro: 0})

	if _, err := crearMeta(ctx, svc, user); err != nil {
		t.Fatalf("primera meta: %v", err)
	}
	_, err := crearMeta(ctx, svc, user)
	esperarTope(t, err, "free", 1, 1)
}

func TestTopeMetas_ElHandlerResponde409ConDetalle(t *testing.T) {
	svc, _, user := setupSavings(t)
	ctx := context.Background()
	for i := 0; i < 3; i++ {
		if _, err := crearMeta(ctx, svc, user); err != nil {
			t.Fatalf("meta %d: %v", i+1, err)
		}
	}

	r := chi.NewRouter()
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			next.ServeHTTP(w, req.WithContext(context.WithValue(req.Context(), middleware.UserIDKey, user)))
		})
	})
	r.Post("/savings/goals", savings.NewHandler(svc).Create)

	req := httptest.NewRequest(http.MethodPost, "/savings/goals",
		strings.NewReader(`{"name":"Cuarta","target_minor":5000,"currency":"CRC"}`))
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusConflict {
		t.Fatalf("codigo %d, se esperaba 409: %s", rec.Code, rec.Body.String())
	}
	var body struct {
		Success bool `json:"success"`
		Error   struct {
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
	if body.Success || body.Error.Code != "SAVINGS_GOAL_LIMIT" || d.Plan != "free" || d.Limite != 3 || d.Actuales != 3 {
		t.Fatalf("respuesta inesperada: %s", rec.Body.String())
	}
}
