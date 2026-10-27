package loyalty_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/kiramopay/backend/internal/loyalty"
)

// El catalogo decia que cualquier premio se podia canjear, aunque el fondo de
// promociones estuviera en cero: la pantalla de premios habilitaba "Canjear" y
// el toque terminaba siempre en LOYALTY_SIN_FONDOS. Ahora cada premio dice si
// se puede canjear AHORA (`redeemable_now`), sin exponer el saldo del fondo.

func catalogoPorLaRuta(t *testing.T, pool *pgxpool.Pool, svc *loyalty.Service) (map[string]map[string]any, string) {
	t.Helper()
	rec := httptest.NewRecorder()
	loyalty.NewHandler(svc).GetRewards(rec, httptest.NewRequest(http.MethodGet, "/api/v1/loyalty/rewards", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("GET rewards = %d: %s", rec.Code, rec.Body.String())
	}
	var sobre struct {
		Data []map[string]any `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &sobre); err != nil {
		t.Fatalf("respuesta ilegible: %v: %s", err, rec.Body.String())
	}
	porId := map[string]map[string]any{}
	for _, r := range sobre.Data {
		porId[r["id"].(string)] = r
	}
	return porId, rec.Body.String()
}

func canjeableAhora(t *testing.T, premios map[string]map[string]any, id string) bool {
	t.Helper()
	p, ok := premios[id]
	if !ok {
		t.Fatalf("el premio %s no esta en el catalogo", id)
	}
	v, presente := p["redeemable_now"]
	if !presente {
		t.Fatalf("el premio %s no dice si se puede canjear ahora: %v", id, p)
	}
	b, ok := v.(bool)
	if !ok {
		t.Fatalf("redeemable_now = %v (%T), se esperaba un booleano", v, v)
	}
	return b
}

func TestCatalogo_SinFondoNingunPremioSePuedeCanjearAhora(t *testing.T) {
	pool, svc, _ := montarCashback(t)
	premio := crearPremio(t, pool, "Cashback ₡500", 500, cashback(50_000))

	premios, _ := catalogoPorLaRuta(t, pool, svc)
	if canjeableAhora(t, premios, premio) {
		t.Fatal("con el fondo en cero el premio dice que se puede canjear: el toque siempre fallaria")
	}
}

func TestCatalogo_CadaPremioDependeDeSiElFondoLoCubre(t *testing.T) {
	pool, svc, _ := montarCashback(t)
	chico := crearPremio(t, pool, "Cashback chico", 500, cashback(50_000))
	grande := crearPremio(t, pool, "Cashback grande", 5_000, cashback(500_000))
	exacto := crearPremio(t, pool, "Cashback exacto", 1_000, cashback(60_000))
	fondear(t, svc, 60_000)

	premios, _ := catalogoPorLaRuta(t, pool, svc)
	if !canjeableAhora(t, premios, chico) {
		t.Fatal("el fondo (60000) cubre el premio de 50000 y dice que no")
	}
	if !canjeableAhora(t, premios, exacto) {
		t.Fatal("el fondo (60000) cubre justo el premio de 60000 y dice que no")
	}
	if canjeableAhora(t, premios, grande) {
		t.Fatal("el fondo (60000) no cubre el premio de 500000 y dice que si")
	}
}

// Un canje que vacia el fondo cambia la respuesta del catalogo.
func TestCatalogo_DespuesDeUnCanjeQueVaciaElFondoYaNoSePuede(t *testing.T) {
	pool, svc, user := montarCashback(t)
	ctx := context.Background()
	premio := crearPremio(t, pool, "Cashback ₡500", 500, cashback(50_000))
	fondear(t, svc, 50_000)
	darPuntos(t, pool, user, 5_000)

	premios, _ := catalogoPorLaRuta(t, pool, svc)
	if !canjeableAhora(t, premios, premio) {
		t.Fatal("con fondo justo el premio dice que no se puede canjear")
	}
	if _, err := svc.RedeemReward(ctx, user, &loyalty.RedeemRewardRequest{RewardID: premio}); err != nil {
		t.Fatalf("canjear: %v", err)
	}
	premios, _ = catalogoPorLaRuta(t, pool, svc)
	if canjeableAhora(t, premios, premio) {
		t.Fatal("el fondo quedo en cero y el premio sigue diciendo que se puede canjear")
	}
}

// Un premio activo sin cashback no tiene como entregarse (ErrPremioSinEntrega):
// no se puede canjear aunque el fondo sobre.
func TestCatalogo_UnPremioSinEntregaNuncaSePuedeCanjear(t *testing.T) {
	pool, svc, _ := montarCashback(t)
	sinEntrega := crearPremio(t, pool, "Sin entrega", 100, nil)
	fondear(t, svc, 10_000_000)

	premios, _ := catalogoPorLaRuta(t, pool, svc)
	if canjeableAhora(t, premios, sinEntrega) {
		t.Fatal("un premio sin entrega dice que se puede canjear")
	}
}

// El catalogo es publico para cualquier usuario: dice SI se puede, nunca CUANTO
// hay en el fondo de promociones.
func TestCatalogo_NoExponeElSaldoDelFondo(t *testing.T) {
	pool, svc, _ := montarCashback(t)
	premio := crearPremio(t, pool, "Cashback ₡500", 500, cashback(50_000))
	fondear(t, svc, 7_654_321)

	premios, cuerpo := catalogoPorLaRuta(t, pool, svc)
	// Dice que se puede (el fondo sobra), y solo eso.
	if !canjeableAhora(t, premios, premio) {
		t.Fatal("el fondo sobra y el premio dice que no se puede canjear")
	}
	if strings.Contains(cuerpo, "7654321") {
		t.Fatalf("el catalogo contiene el saldo del fondo: %s", cuerpo)
	}
	for _, p := range premios {
		for clave := range p {
			if strings.Contains(clave, "saldo") || strings.Contains(clave, "fund") || strings.Contains(clave, "balance") {
				t.Fatalf("el premio expone un campo del fondo: %q", clave)
			}
		}
	}
}
