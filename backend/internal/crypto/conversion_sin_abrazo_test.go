package crypto_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Dos conversiones de la MISMA persona en sentidos opuestos —BTC a ETH y ETH a
// BTC a la vez— se bloqueaban entre si: cada transaccion tomaba primero la fila
// del activo de ORIGEN y despues pedia la de destino, que la otra ya tenia.
// Postgres rompe el empate matando una con 40P01 y a esa persona le sale el
// error crudo de la base de datos.
//
// Lo que deshace el abrazo es tomar las dos filas SIEMPRE en el mismo orden.
// Esta prueba lo comprueba sin depender de que dos goroutines se crucen en el
// instante justo: retiene desde afuera la fila del simbolo que va PRIMERO en
// ese orden (BTC) y mira si una conversion ETH a BTC se queda esperando ahi SIN
// haberse llevado antes la fila de ETH. Tener una fila tomada mientras se
// espera la otra es exactamente la mitad del abrazo.

// esperarUnBloqueo espera a que alguna transaccion quede esperando un bloqueo.
// Sin esto habria que adivinar con un sleep cuanto tarda la conversion en
// llegar a la fila retenida.
func esperarUnBloqueo(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	limite := time.Now().Add(10 * time.Second)
	for time.Now().Before(limite) {
		var esperando int
		if err := pool.QueryRow(context.Background(),
			`SELECT COUNT(*) FROM pg_locks WHERE NOT granted`).Scan(&esperando); err != nil {
			t.Fatalf("consultar pg_locks: %v", err)
		}
		if esperando > 0 {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("ninguna transaccion quedo esperando un bloqueo")
}

func TestConversion_NoSeLlevaElActivoDeOrigenMientrasEsperaElDeDestino(t *testing.T) {
	repo, pool, userID := montarRepo(t)
	ctx := context.Background()

	if err := repo.UpsertAsset(ctx, userID, "BTC", "Bitcoin", d(2), d(1000)); err != nil {
		t.Fatalf("sembrar BTC: %v", err)
	}
	if err := repo.UpsertAsset(ctx, userID, "ETH", "Ethereum", d(4), d(500)); err != nil {
		t.Fatalf("sembrar ETH: %v", err)
	}

	// Una transaccion ajena retiene BTC, el primero del orden. Hace de "la otra
	// conversion" sin necesidad de sincronizar dos goroutines.
	retencion, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("abrir la transaccion que retiene BTC: %v", err)
	}
	defer func() { _ = retencion.Rollback(ctx) }()
	if _, err := retencion.Exec(ctx,
		`SELECT 1 FROM crypto_assets WHERE user_id = $1 AND symbol = 'BTC' FOR UPDATE`, userID); err != nil {
		t.Fatalf("retener BTC: %v", err)
	}

	hecho := make(chan error, 1)
	go func() {
		hecho <- repo.ConvertirEnUnaTx(ctx, userID, "ETH", "BTC", "Bitcoin",
			d(1), d(1), d(1000), movimiento(userID))
	}()
	esperarUnBloqueo(t, pool)

	// ETH tiene que estar libre: la conversion no puede retener el activo de
	// origen mientras espera el de destino.
	sonda, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("abrir la transaccion que sondea ETH: %v", err)
	}
	_, errSonda := sonda.Exec(ctx,
		`SELECT 1 FROM crypto_assets WHERE user_id = $1 AND symbol = 'ETH' FOR UPDATE NOWAIT`, userID)
	_ = sonda.Rollback(ctx)
	if errSonda != nil {
		var pgErr *pgconn.PgError
		// 55P03 lock_not_available: alguien mas tiene la fila de ETH, y el unico
		// candidato es la conversion que esta esperando BTC.
		if errors.As(errSonda, &pgErr) && pgErr.Code == "55P03" {
			t.Fatal("la conversion retiene ETH mientras espera BTC: dos conversiones en sentidos opuestos se abrazan y Postgres mata una con 40P01")
		}
		t.Fatalf("sondear ETH: %v", errSonda)
	}

	// Al soltar BTC la conversion termina sola y sin abrazo.
	if err := retencion.Rollback(ctx); err != nil {
		t.Fatalf("soltar BTC: %v", err)
	}
	select {
	case err := <-hecho:
		if err != nil {
			t.Fatalf("la conversion fallo: %v", err)
		}
	case <-time.After(15 * time.Second):
		t.Fatal("la conversion no termino despues de soltar BTC")
	}

	if got := saldoDe(t, repo, userID, "ETH"); !got.Equal(d(3)) {
		t.Fatalf("ETH = %s, se esperaba 3", got)
	}
	if got := saldoDe(t, repo, userID, "BTC"); !got.Equal(d(3)) {
		t.Fatalf("BTC = %s, se esperaba 3", got)
	}
}
