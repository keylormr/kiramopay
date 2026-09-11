package loyalty_test

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/kiramopay/backend/internal/ledger"
	"github.com/kiramopay/backend/internal/loyalty"
	"github.com/kiramopay/backend/internal/testutil"
	"github.com/kiramopay/backend/internal/transaction"
	"github.com/kiramopay/backend/internal/wallet"
)

// Canjear un premio descontaba los puntos y devolvia un codigo que nadie leia.
// Ahora el cashback es un asiento de verdad que sale de la cuenta de
// promociones, y se rechaza si no alcanza: nunca se regala plata que no existe.

const adminDePrueba = "00000000-0000-0000-0000-000000000002" // SeedTestUser2

func montarCashback(t *testing.T) (*pgxpool.Pool, *loyalty.Service, string) {
	t.Helper()
	pool := testutil.TestDB(t)
	user := testutil.SeedTestUser(t, pool, "702650930", "dummy")
	testutil.SeedTestUser2(t, pool)
	eng := ledger.NewEngine(pool, slog.New(slog.NewTextHandler(os.Stdout, nil)))
	txSvc := transaction.NewService(transaction.NewRepository(pool), wallet.NewRepository(pool), eng, &transaction.Options{})
	svc := loyalty.NewService(loyalty.NewRepository(pool), &loyalty.Options{Ledger: eng})
	svc.UsarHistorial(txSvc)
	return pool, svc, user
}

func darPuntos(t *testing.T, pool *pgxpool.Pool, user string, puntos int64) {
	t.Helper()
	if _, err := pool.Exec(context.Background(), `
		INSERT INTO loyalty_accounts (user_id, total_points, available_points, lifetime_points)
		VALUES ($1::uuid, $2, $2, $2)
		ON CONFLICT (user_id) DO UPDATE SET available_points = EXCLUDED.available_points`,
		user, puntos); err != nil {
		t.Fatalf("dar puntos: %v", err)
	}
}

func crearPremio(t *testing.T, pool *pgxpool.Pool, nombre string, puntos int64, cashback *int64) string {
	t.Helper()
	var id string
	if err := pool.QueryRow(context.Background(), `
		INSERT INTO loyalty_rewards (name, category, points_cost, stock, active, cashback_minor)
		VALUES ($1, 'discount', $2, -1, TRUE, $3) RETURNING id::text`,
		nombre, puntos, cashback).Scan(&id); err != nil {
		t.Fatalf("crear premio: %v", err)
	}
	return id
}

func puntosDe(t *testing.T, pool *pgxpool.Pool, user string) int64 {
	t.Helper()
	var p int64
	if err := pool.QueryRow(context.Background(),
		`SELECT available_points FROM loyalty_accounts WHERE user_id = $1::uuid`, user).Scan(&p); err != nil {
		t.Fatalf("leer puntos: %v", err)
	}
	return p
}

func billetera(t *testing.T, pool *pgxpool.Pool, user string) int64 {
	t.Helper()
	var b int64
	if err := pool.QueryRow(context.Background(),
		`SELECT balance_crc FROM wallets WHERE user_id = $1::uuid`, user).Scan(&b); err != nil {
		t.Fatalf("leer billetera: %v", err)
	}
	return b
}

func fondear(t *testing.T, svc *loyalty.Service, monto int64) {
	t.Helper()
	if _, err := svc.FondearPromociones(context.Background(), adminDePrueba, monto, "TRF-PRUEBA", uuid.NewString()); err != nil {
		t.Fatalf("fondear: %v", err)
	}
}

func cashback(v int64) *int64 { return &v }

func TestUnCanjeDeCashbackPagaDesdeElFondo(t *testing.T) {
	pool, svc, user := montarCashback(t)
	ctx := context.Background()
	fondear(t, svc, 1_000_000)
	darPuntos(t, pool, user, 1_000)
	premio := crearPremio(t, pool, "Cashback ₡500", 500, cashback(50_000))
	antes := billetera(t, pool, user)

	rd, err := svc.RedeemReward(ctx, user, &loyalty.RedeemRewardRequest{RewardID: premio})
	if err != nil {
		t.Fatalf("RedeemReward: %v", err)
	}
	if rd.CashbackMinor != 50_000 {
		t.Fatalf("cashback del canje = %d, se esperaba 50000", rd.CashbackMinor)
	}
	if got := billetera(t, pool, user); got != antes+50_000 {
		t.Fatalf("billetera = %d, se esperaba %d: el premio tiene que LLEGAR", got, antes+50_000)
	}
	if got := puntosDe(t, pool, user); got != 500 {
		t.Fatalf("puntos = %d, se esperaba 500", got)
	}
	if saldo, _ := svc.SaldoPromociones(ctx); saldo != 950_000 {
		t.Fatalf("fondo de promociones = %d, se esperaba 950000", saldo)
	}
	var filas int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM transactions
		WHERE user_id = $1::uuid AND type = $2 AND status = 'completed' AND amount = 50000`,
		user, loyalty.TipoCashback).Scan(&filas); err != nil || filas != 1 {
		t.Fatalf("filas de historial del cashback = %d (err %v), se esperaba 1", filas, err)
	}
}

func TestSinFondosNoSeCanjeaNiSeDescuentanPuntos(t *testing.T) {
	pool, svc, user := montarCashback(t)
	ctx := context.Background()
	darPuntos(t, pool, user, 1_000)
	premio := crearPremio(t, pool, "Cashback ₡500", 500, cashback(50_000))
	antes := billetera(t, pool, user)

	if _, err := svc.RedeemReward(ctx, user, &loyalty.RedeemRewardRequest{RewardID: premio}); !errors.Is(err, loyalty.ErrSinFondosPromocion) {
		t.Fatalf("err = %v, se esperaba ErrSinFondosPromocion", err)
	}
	if got := puntosDe(t, pool, user); got != 1_000 {
		t.Fatalf("puntos = %d: se descontaron puntos por un premio que no se pago", got)
	}
	if got := billetera(t, pool, user); got != antes {
		t.Fatalf("billetera = %d, se esperaba %d", got, antes)
	}
	if saldo, _ := svc.SaldoPromociones(ctx); saldo != 0 {
		t.Fatalf("fondo = %d, se esperaba 0: nunca puede quedar negativo", saldo)
	}
}

// Un premio sin entrega no se canjea aunque alguien lo active a mano.
func TestUnPremioSinEntregaNoSeCanjea(t *testing.T) {
	pool, svc, user := montarCashback(t)
	fondear(t, svc, 1_000_000)
	darPuntos(t, pool, user, 1_000)
	premio := crearPremio(t, pool, "SINPE gratis x5", 750, nil)

	if _, err := svc.RedeemReward(context.Background(), user, &loyalty.RedeemRewardRequest{RewardID: premio}); !errors.Is(err, loyalty.ErrPremioSinEntrega) {
		t.Fatalf("err = %v, se esperaba ErrPremioSinEntrega", err)
	}
	if got := puntosDe(t, pool, user); got != 1_000 {
		t.Fatalf("puntos = %d, se esperaba 1000 intactos", got)
	}
}

// Dos canjes a la vez con fondo para uno solo: pasa uno. Las cuentas de sistema
// del libro no tienen piso propio; el piso lo pone el bloqueo del fondo.
func TestDosCanjesConFondoParaUno(t *testing.T) {
	pool, svc, user := montarCashback(t)
	ctx := context.Background()
	fondear(t, svc, 50_000)
	darPuntos(t, pool, user, 2_000)
	premio := crearPremio(t, pool, "Cashback ₡500", 500, cashback(50_000))
	antes := billetera(t, pool, user)

	var (
		wg      sync.WaitGroup
		salida  = make(chan struct{})
		mu      sync.Mutex
		errores []error
	)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-salida
			_, err := svc.RedeemReward(ctx, user, &loyalty.RedeemRewardRequest{RewardID: premio})
			mu.Lock()
			errores = append(errores, err)
			mu.Unlock()
		}()
	}
	close(salida)
	wg.Wait()

	pasaron, sinFondos := 0, 0
	for _, err := range errores {
		switch {
		case err == nil:
			pasaron++
		case errors.Is(err, loyalty.ErrSinFondosPromocion):
			sinFondos++
		default:
			t.Fatalf("error inesperado: %v", err)
		}
	}
	if pasaron != 1 || sinFondos != 1 {
		t.Fatalf("pasaron %d, sin fondos %d; se esperaba uno de cada", pasaron, sinFondos)
	}
	if saldo, _ := svc.SaldoPromociones(ctx); saldo != 0 {
		t.Fatalf("fondo = %d, se esperaba 0 (nunca negativo)", saldo)
	}
	if got := billetera(t, pool, user); got != antes+50_000 {
		t.Fatalf("billetera = %d, se esperaba %d", got, antes+50_000)
	}
}

// Fondear sube la reserva publicada: exige referencia, y la misma llave no
// fondea dos veces.
func TestFondearExigeReferenciaYEsIdempotente(t *testing.T) {
	_, svc, _ := montarCashback(t)
	ctx := context.Background()

	for _, c := range []struct {
		monto       int64
		ref, llave string
	}{
		{0, "TRF-1", "k1"}, {1_000, "", "k2"}, {1_000, "ab", "k3"}, {1_000, "TRF-1", ""},
	} {
		if _, err := svc.FondearPromociones(ctx, adminDePrueba, c.monto, c.ref, c.llave); !errors.Is(err, loyalty.ErrFondeoInvalido) {
			t.Fatalf("%+v: err = %v, se esperaba ErrFondeoInvalido", c, err)
		}
	}

	saldo, err := svc.FondearPromociones(ctx, adminDePrueba, 300_000, "TRF-2026-0911", "llave-unica")
	if err != nil || saldo != 300_000 {
		t.Fatalf("fondear: saldo=%d err=%v", saldo, err)
	}
	// Un doble toque con la misma llave no fondea dos veces.
	if saldo, err := svc.FondearPromociones(ctx, adminDePrueba, 300_000, "TRF-2026-0911", "llave-unica"); err != nil || saldo != 300_000 {
		t.Fatalf("segundo fondeo con la misma llave: saldo=%d err=%v", saldo, err)
	}
}
