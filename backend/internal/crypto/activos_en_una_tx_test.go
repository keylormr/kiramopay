package crypto_test

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/kiramopay/backend/internal/crypto"
	"github.com/kiramopay/backend/internal/testutil"
	"github.com/kiramopay/backend/pkg/hash"
	"github.com/shopspring/decimal"
)

// Los activos de cripto NO pasan por el motor de doble partida: viven en su
// propia tabla, sin asiento que los explique y sin conciliacion que levante un
// faltante. Por eso una escritura a medias aqui es una perdida directa y
// silenciosa, y por eso el arreglo es una transaccion propia del repositorio.

func montarRepo(t *testing.T) (*crypto.Repository, *pgxpool.Pool, string) {
	t.Helper()
	pool := testutil.TestDB(t)
	pinHash, _ := hash.HashPin("1234")
	userID := testutil.SeedTestUser(t, pool, "702650930", pinHash)
	return crypto.NewRepository(pool), pool, userID
}

func saldoDe(t *testing.T, repo *crypto.Repository, userID, simbolo string) decimal.Decimal {
	t.Helper()
	a, err := repo.GetAsset(context.Background(), userID, simbolo)
	if err != nil {
		return decimal.Zero
	}
	return a.Balance
}

func movimiento(userID string) *crypto.TransactionRecord {
	return &crypto.TransactionRecord{
		UserID: userID, Type: "convert", Asset: "BTC→ETH",
		Amount: d(1), Price: d(2000), Total: d(2), Currency: "ETH",
		Fee: decimal.Zero, Status: "completed", CreatedAt: time.Now(),
	}
}

// La conversion feliz: los dos activos se mueven y el movimiento queda anotado.
func TestConvertirMueveLosDosActivos(t *testing.T) {
	repo, _, userID := montarRepo(t)
	ctx := context.Background()

	if err := repo.UpsertAsset(ctx, userID, "BTC", "Bitcoin", d(2), d(1000)); err != nil {
		t.Fatalf("sembrar BTC: %v", err)
	}

	if err := repo.ConvertirEnUnaTx(ctx, userID, "BTC", "ETH", "Ethereum",
		d(1), d(2), d(500), movimiento(userID)); err != nil {
		t.Fatalf("ConvertirEnUnaTx: %v", err)
	}

	if got := saldoDe(t, repo, userID, "BTC"); !got.Equal(d(1)) {
		t.Fatalf("BTC = %s, se esperaba 1", got)
	}
	if got := saldoDe(t, repo, userID, "ETH"); !got.Equal(d(2)) {
		t.Fatalf("ETH = %s, se esperaba 2", got)
	}
}

// Lo que fallaba: eran escrituras sueltas. Si la ultima se caia, el activo de
// origen ya estaba descontado y el de destino no habia llegado. Aqui se fuerza
// ese fallo con un movimiento cuyo id ya existe.
func TestUnFalloAlFinalNoDejaElActivoADebiendo(t *testing.T) {
	repo, _, userID := montarRepo(t)
	ctx := context.Background()

	if err := repo.UpsertAsset(ctx, userID, "BTC", "Bitcoin", d(2), d(1000)); err != nil {
		t.Fatalf("sembrar BTC: %v", err)
	}
	yaExiste := movimiento(userID)
	yaExiste.ID = uuid.New().String()
	if err := repo.AddTransaction(ctx, yaExiste); err != nil {
		t.Fatalf("anotar el primer movimiento: %v", err)
	}

	// Mismo id: el INSERT del final choca con la llave primaria.
	choca := movimiento(userID)
	choca.ID = yaExiste.ID
	if err := repo.ConvertirEnUnaTx(ctx, userID, "BTC", "ETH", "Ethereum",
		d(1), d(2), d(500), choca); err == nil {
		t.Fatal("se esperaba error: el movimiento no se pudo anotar")
	}

	if got := saldoDe(t, repo, userID, "BTC"); !got.Equal(d(2)) {
		t.Fatalf("BTC = %s, se esperaba 2: el descuento no se revirtio", got)
	}
	if got := saldoDe(t, repo, userID, "ETH"); !got.IsZero() {
		t.Fatalf("ETH = %s, se esperaba 0: se acredito un activo de una conversion que fallo", got)
	}
}

func TestConvertirSinSaldoNoCreaElActivoDeDestino(t *testing.T) {
	repo, _, userID := montarRepo(t)
	ctx := context.Background()

	if err := repo.UpsertAsset(ctx, userID, "BTC", "Bitcoin", d(1), d(1000)); err != nil {
		t.Fatalf("sembrar BTC: %v", err)
	}

	err := repo.ConvertirEnUnaTx(ctx, userID, "BTC", "ETH", "Ethereum",
		d(5), d(10), d(500), movimiento(userID))
	if !errors.Is(err, crypto.ErrSaldoDeActivoInsuficiente) {
		t.Fatalf("error = %v, se esperaba ErrSaldoDeActivoInsuficiente", err)
	}
	if got := saldoDe(t, repo, userID, "ETH"); !got.IsZero() {
		t.Fatalf("ETH = %s, se esperaba 0", got)
	}
	if got := saldoDe(t, repo, userID, "BTC"); !got.Equal(d(1)) {
		t.Fatalf("BTC = %s, se esperaba 1", got)
	}
}

// La comprobacion de saldo que hace el servicio lee FUERA de la transaccion,
// asi que dos conversiones simultaneas del mismo activo la pasaban las dos. La
// guarda del UPDATE es la unica que de verdad frena.
func TestDosConversionesSimultaneasNoDejanSaldoNegativo(t *testing.T) {
	repo, _, userID := montarRepo(t)
	ctx := context.Background()

	if err := repo.UpsertAsset(ctx, userID, "BTC", "Bitcoin", d(1), d(1000)); err != nil {
		t.Fatalf("sembrar BTC: %v", err)
	}

	var wg sync.WaitGroup
	errs := make([]error, 2)
	for i := range errs {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			errs[i] = repo.ConvertirEnUnaTx(ctx, userID, "BTC", "ETH", "Ethereum",
				d(1), d(2), d(500), movimiento(userID))
		}(i)
	}
	wg.Wait()

	exitos := 0
	for _, err := range errs {
		if err == nil {
			exitos++
		}
	}
	if exitos != 1 {
		t.Fatalf("conversiones exitosas = %d, se esperaba 1 (errs=%v)", exitos, errs)
	}
	if got := saldoDe(t, repo, userID, "BTC"); !got.IsZero() {
		t.Fatalf("BTC = %s, se esperaba 0", got)
	}
	if got := saldoDe(t, repo, userID, "ETH"); !got.Equal(d(2)) {
		t.Fatalf("ETH = %s, se esperaba 2 (se acredito dos veces)", got)
	}
}

func TestStakingApartaElActivoYEscribeLaPosicionJuntos(t *testing.T) {
	repo, pool, userID := montarRepo(t)
	ctx := context.Background()

	if err := repo.UpsertAsset(ctx, userID, "ETH", "Ethereum", d(3), d(2000)); err != nil {
		t.Fatalf("sembrar ETH: %v", err)
	}
	pos := &crypto.StakingRecord{
		UserID: userID, Asset: "ETH", Amount: d(2), APY: 4.5,
		StartDate: time.Now(), Earned: decimal.Zero, Status: "active",
	}
	if err := repo.ApartarParaStakingEnUnaTx(ctx, pos); err != nil {
		t.Fatalf("ApartarParaStakingEnUnaTx: %v", err)
	}

	if got := saldoDe(t, repo, userID, "ETH"); !got.Equal(d(1)) {
		t.Fatalf("ETH = %s, se esperaba 1", got)
	}
	var n int
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM crypto_staking WHERE id = $1`, pos.ID).Scan(&n); err != nil {
		t.Fatalf("contar posiciones: %v", err)
	}
	if n != 1 {
		t.Fatalf("posiciones = %d, se esperaba 1", n)
	}
}

func TestStakingSinSaldoNoDejaPosicionNiDescuento(t *testing.T) {
	repo, pool, userID := montarRepo(t)
	ctx := context.Background()

	if err := repo.UpsertAsset(ctx, userID, "ETH", "Ethereum", d(1), d(2000)); err != nil {
		t.Fatalf("sembrar ETH: %v", err)
	}
	pos := &crypto.StakingRecord{
		UserID: userID, Asset: "ETH", Amount: d(5), APY: 4.5,
		StartDate: time.Now(), Earned: decimal.Zero, Status: "active",
	}
	if err := repo.ApartarParaStakingEnUnaTx(ctx, pos); !errors.Is(err, crypto.ErrSaldoDeActivoInsuficiente) {
		t.Fatalf("error = %v, se esperaba ErrSaldoDeActivoInsuficiente", err)
	}
	if got := saldoDe(t, repo, userID, "ETH"); !got.Equal(d(1)) {
		t.Fatalf("ETH = %s, se esperaba 1", got)
	}
	var n int
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM crypto_staking WHERE user_id = $1::uuid`, userID).Scan(&n); err != nil {
		t.Fatalf("contar posiciones: %v", err)
	}
	if n != 0 {
		t.Fatalf("posiciones = %d, se esperaba 0", n)
	}
}
