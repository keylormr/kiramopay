package loyalty_test

import (
	"context"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/kiramopay/backend/internal/loyalty"
)

// La migracion 070 se prueba ejecutando SU PROPIO archivo: el esquema de
// pruebas no lee migrations/, y una copia del SQL aca podria divergir de la que
// corre en produccion.
func correr070(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	sql, err := os.ReadFile("../../migrations/070_cashback_con_existencia.sql")
	if err != nil {
		t.Fatalf("leer migracion: %v", err)
	}
	if _, err := pool.Exec(context.Background(), string(sql)); err != nil {
		t.Fatalf("correr migracion: %v", err)
	}
}

// premioComoQuedo inserta un premio con el activo y la existencia exactos, sin
// pasar por las reglas del servicio: asi quedaron las filas en produccion.
func premioComoQuedo(t *testing.T, pool *pgxpool.Pool, nombre string, puntos int64, activo bool, existencia int, entrega *int64) string {
	t.Helper()
	var id string
	if err := pool.QueryRow(context.Background(), `
		INSERT INTO loyalty_rewards (name, category, points_cost, stock, active, cashback_minor)
		VALUES ($1, 'discount', $2, $3, $4, $5) RETURNING id::text`,
		nombre, puntos, existencia, activo, entrega).Scan(&id); err != nil {
		t.Fatalf("insertar premio %s: %v", nombre, err)
	}
	return id
}

func existenciaDe(t *testing.T, pool *pgxpool.Pool, id string) int {
	t.Helper()
	var s int
	if err := pool.QueryRow(context.Background(),
		`SELECT stock FROM loyalty_rewards WHERE id = $1::uuid`, id).Scan(&s); err != nil {
		t.Fatalf("leer existencia: %v", err)
	}
	return s
}

// Lo que se vio en produccion el 2026-09-13: los cashback activos pero con
// existencia cero (la 060 la dejo en cero y la 066 solo los reactivo). El
// catalogo salia vacio y el canje respondia "agotado".
func TestMigracion070_ElCashbackVuelveAlCatalogo(t *testing.T) {
	pool, svc, user := montarCashback(t)
	ctx := context.Background()

	// Como los dejaron la 060 y la 066.
	quinientos := premioComoQuedo(t, pool, "Cashback ₡500", 500, true, 0, cashback(50_000))
	mil := premioComoQuedo(t, pool, "Cashback ₡1,000", 900, true, 0, cashback(100_000))
	// Insertado por la 066 cuando no existia: ya venia sin limite.
	dosMil := premioComoQuedo(t, pool, "Cashback ₡2,500", 2000, true, -1, cashback(250_000))
	// Un cashback con tope puesto a proposito conserva su tope.
	conTope := premioComoQuedo(t, pool, "Cashback ₡5,000", 3800, true, 7, cashback(500_000))
	// Los que no entregan nada: la 060 los dejo en cero y la 066 inactivos.
	sinpeGratis := premioComoQuedo(t, pool, "SINPE gratis x5", 750, false, 0, nil)
	// Aunque alguien lo haya encendido a mano, sin entrega no vuelve.
	encendidoAMano := premioComoQuedo(t, pool, "Comision crypto 0%", 1000, true, 0, nil)

	// El defecto, antes de la migracion: el catalogo solo muestra los que ya
	// estaban sin limite.
	antes, err := svc.GetRewards(ctx)
	if err != nil {
		t.Fatalf("GetRewards antes: %v", err)
	}
	if !soloEstos(antes, dosMil, conTope) {
		t.Fatalf("antes de la 070 el catalogo tenia %v; se esperaba solo el de ₡2,500 y el de ₡5,000", nombres(antes))
	}

	correr070(t, pool)

	despues, err := svc.GetRewards(ctx)
	if err != nil {
		t.Fatalf("GetRewards despues: %v", err)
	}
	if !soloEstos(despues, quinientos, mil, dosMil, conTope) {
		t.Fatalf("despues de la 070 el catalogo tiene %v; se esperaban los cuatro cashback y ningun otro", nombres(despues))
	}

	for id, esperada := range map[string]int{
		quinientos:     -1,
		mil:            -1,
		dosMil:         -1,
		conTope:        7,
		sinpeGratis:    0,
		encendidoAMano: 0,
	} {
		if got := existenciaDe(t, pool, id); got != esperada {
			t.Fatalf("premio %s: existencia %d, se esperaba %d", id, got, esperada)
		}
	}

	// Idempotente: una segunda pasada no cambia nada.
	correr070(t, pool)
	if got := existenciaDe(t, pool, conTope); got != 7 {
		t.Fatalf("la segunda pasada toco el tope: %d", got)
	}

	// Y el canje que antes respondia "agotado" ahora paga de verdad, sin
	// consumir una existencia que no tiene limite.
	fondear(t, svc, 1_000_000)
	darPuntos(t, pool, user, 1_000)
	antesBilletera := billetera(t, pool, user)
	if _, err := svc.RedeemReward(ctx, user, &loyalty.RedeemRewardRequest{RewardID: quinientos}); err != nil {
		t.Fatalf("RedeemReward tras la 070: %v", err)
	}
	if got := billetera(t, pool, user); got != antesBilletera+50_000 {
		t.Fatalf("billetera = %d, se esperaba %d", got, antesBilletera+50_000)
	}
	if got := existenciaDe(t, pool, quinientos); got != -1 {
		t.Fatalf("el canje cambio la existencia sin limite a %d", got)
	}
}

func soloEstos(premios []loyalty.Reward, ids ...string) bool {
	if len(premios) != len(ids) {
		return false
	}
	esperados := make(map[string]bool, len(ids))
	for _, id := range ids {
		esperados[id] = true
	}
	for _, p := range premios {
		if !esperados[p.ID] {
			return false
		}
	}
	return true
}

func nombres(premios []loyalty.Reward) []string {
	out := make([]string, 0, len(premios))
	for _, p := range premios {
		out = append(out, p.Name)
	}
	return out
}
