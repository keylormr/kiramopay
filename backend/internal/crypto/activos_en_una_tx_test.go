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

	if _, _, err := repo.ConvertirEnUnaTx(ctx, userID, "BTC", "ETH", "Ethereum",
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
// que el abono falle DESPUES del descuento —un abono de cero no se acepta—, con
// el movimiento ya escrito, porque ahora es la primera escritura.
func TestUnFalloAlFinalNoDejaElActivoADebiendo(t *testing.T) {
	repo, pool, userID := montarRepo(t)
	ctx := context.Background()

	if err := repo.UpsertAsset(ctx, userID, "BTC", "Bitcoin", d(2), d(1000)); err != nil {
		t.Fatalf("sembrar BTC: %v", err)
	}

	falla := movimiento(userID)
	falla.IdempotencyKey = "crypto:convert:falla-al-final"
	if _, _, err := repo.ConvertirEnUnaTx(ctx, userID, "BTC", "ETH", "Ethereum",
		d(1), decimal.Zero, d(500), falla); err == nil {
		t.Fatal("se esperaba error: el abono de cero no se acepta")
	}

	if got := saldoDe(t, repo, userID, "BTC"); !got.Equal(d(2)) {
		t.Fatalf("BTC = %s, se esperaba 2: el descuento no se revirtio", got)
	}
	if got := saldoDe(t, repo, userID, "ETH"); !got.IsZero() {
		t.Fatalf("ETH = %s, se esperaba 0: se acredito un activo de una conversion que fallo", got)
	}
	// El movimiento tampoco puede quedar: con la llave escrita, el reintento
	// devolveria como hecha una conversion que no ocurrio.
	var n int
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM crypto_transactions WHERE user_id = $1::uuid`, userID).Scan(&n); err != nil {
		t.Fatalf("contar movimientos: %v", err)
	}
	if n != 0 {
		t.Fatalf("movimientos = %d, se esperaba 0", n)
	}

	// Y el reintento con esa llave convierte de verdad, no repite.
	reintento := movimiento(userID)
	reintento.IdempotencyKey = falla.IdempotencyKey
	_, repetido, err := repo.ConvertirEnUnaTx(ctx, userID, "BTC", "ETH", "Ethereum",
		d(1), d(2), d(500), reintento)
	if err != nil || repetido {
		t.Fatalf("reintento: repetido=%v err=%v, se esperaba una conversion nueva", repetido, err)
	}
	if got := saldoDe(t, repo, userID, "ETH"); !got.Equal(d(2)) {
		t.Fatalf("ETH = %s, se esperaba 2", got)
	}
}

// El indice de la llave no es la unica restriccion que da 23505: la llave
// primaria tambien. Un id repetido es un error, no el reintento de nada, y no
// puede devolverse como si la operacion se hubiera hecho. Las tres funciones
// que pasan por anotarConLlave lo tienen que distinguir igual: convertir,
// apartar para staking y enviar.
func TestUnIdRepetidoNoEsUnReintento(t *testing.T) {
	t.Run("convertir", func(t *testing.T) {
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

		choca := movimiento(userID)
		choca.ID = yaExiste.ID
		choca.IdempotencyKey = "crypto:convert:id-repetido"
		previo, repetido, err := repo.ConvertirEnUnaTx(ctx, userID, "BTC", "ETH", "Ethereum",
			d(1), d(2), d(500), choca)
		if err == nil || repetido || previo != nil {
			t.Fatalf("previo=%v repetido=%v err=%v, se esperaba el error de la llave primaria", previo, repetido, err)
		}
		if got := saldoDe(t, repo, userID, "BTC"); !got.Equal(d(2)) {
			t.Fatalf("BTC = %s, se esperaba 2", got)
		}
		if got := saldoDe(t, repo, userID, "ETH"); !got.IsZero() {
			t.Fatalf("ETH = %s, se esperaba 0", got)
		}
	})

	// ApartarParaStakingEnUnaTx le da al movimiento el MISMO id que la posicion
	// (ver el comentario de la funcion en repository.go): forzar ese id a uno
	// que ya existe en crypto_transactions choca con la llave primaria, igual
	// que en convertir.
	t.Run("apartar", func(t *testing.T) {
		repo, pool, userID := montarRepo(t)
		ctx := context.Background()

		if err := repo.UpsertAsset(ctx, userID, "ETH", "Ethereum", d(3), d(2000)); err != nil {
			t.Fatalf("sembrar ETH: %v", err)
		}
		yaExiste := movimiento(userID)
		yaExiste.ID = uuid.New().String()
		if err := repo.AddTransaction(ctx, yaExiste); err != nil {
			t.Fatalf("anotar el primer movimiento: %v", err)
		}

		pos := &crypto.StakingRecord{
			ID: yaExiste.ID, UserID: userID, Asset: "ETH", Amount: d(1), APY: 4.5,
			StartDate: time.Now(), Earned: decimal.Zero, Status: "active",
		}
		previo, repetido, err := repo.ApartarParaStakingEnUnaTx(ctx, pos, "crypto:stake:id-repetido")
		if err == nil || repetido || previo != nil {
			t.Fatalf("previo=%v repetido=%v err=%v, se esperaba el error de la llave primaria", previo, repetido, err)
		}
		if got := saldoDe(t, repo, userID, "ETH"); !got.Equal(d(3)) {
			t.Fatalf("ETH = %s, se esperaba 3: no se descuenta si el movimiento no se pudo anotar", got)
		}
		var n int
		if err := pool.QueryRow(ctx,
			`SELECT COUNT(*) FROM crypto_staking WHERE user_id = $1::uuid`, userID).Scan(&n); err != nil {
			t.Fatalf("contar posiciones: %v", err)
		}
		if n != 0 {
			t.Fatalf("posiciones = %d, se esperaba 0", n)
		}
	})

	// EnviarEnUnaTx tambien deja fijar de antemano el id del movimiento de
	// quien envia (ver repositorio_envio.go); forzarlo al de un movimiento
	// existente es la misma carrera, ahora entre dos personas.
	t.Run("enviar", func(t *testing.T) {
		repo, pool, userID := montarRepo(t)
		ctx := context.Background()
		destinatario := testutil.SeedTestUser2(t, pool)

		if err := repo.UpsertAsset(ctx, userID, "BTC", "Bitcoin", d(2), d(1000)); err != nil {
			t.Fatalf("sembrar BTC: %v", err)
		}
		yaExiste := movimiento(userID)
		yaExiste.ID = uuid.New().String()
		if err := repo.AddTransaction(ctx, yaExiste); err != nil {
			t.Fatalf("anotar el primer movimiento: %v", err)
		}

		envio := &crypto.TransactionRecord{
			ID: yaExiste.ID, UserID: userID, Type: "send", Asset: "BTC",
			Amount: d(1), Price: d(1000), Total: d(1), Currency: "BTC",
			Fee: decimal.Zero, Status: "completed",
			CounterpartyUserID: destinatario, IdempotencyKey: "crypto:send:id-repetido",
		}
		recibo := &crypto.TransactionRecord{
			UserID: destinatario, Type: "receive", Asset: "BTC",
			Amount: d(1), Price: d(1000), Total: d(1), Currency: "BTC",
			Fee: decimal.Zero, Status: "completed", CounterpartyUserID: userID,
		}
		previo, repetido, err := repo.EnviarEnUnaTx(ctx, &crypto.DatosDelEnvio{
			Envio: envio, Recibo: recibo, NombreDelActivo: "Bitcoin", PrecioUSD: d(1000),
		})
		if err == nil || repetido || previo != nil {
			t.Fatalf("previo=%v repetido=%v err=%v, se esperaba el error de la llave primaria", previo, repetido, err)
		}
		if got := saldoDe(t, repo, userID, "BTC"); !got.Equal(d(2)) {
			t.Fatalf("BTC de quien envia = %s, se esperaba 2", got)
		}
		if got := saldoDe(t, repo, destinatario, "BTC"); !got.IsZero() {
			t.Fatalf("BTC de quien recibe = %s, se esperaba 0", got)
		}
	})
}

func TestConvertirSinSaldoNoCreaElActivoDeDestino(t *testing.T) {
	repo, _, userID := montarRepo(t)
	ctx := context.Background()

	if err := repo.UpsertAsset(ctx, userID, "BTC", "Bitcoin", d(1), d(1000)); err != nil {
		t.Fatalf("sembrar BTC: %v", err)
	}

	_, _, err := repo.ConvertirEnUnaTx(ctx, userID, "BTC", "ETH", "Ethereum",
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
			_, _, errs[i] = repo.ConvertirEnUnaTx(ctx, userID, "BTC", "ETH", "Ethereum",
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
	if _, _, err := repo.ApartarParaStakingEnUnaTx(ctx, pos, ""); err != nil {
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
	if _, _, err := repo.ApartarParaStakingEnUnaTx(ctx, pos, ""); !errors.Is(err, crypto.ErrSaldoDeActivoInsuficiente) {
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
