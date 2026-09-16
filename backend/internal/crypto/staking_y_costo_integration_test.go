package crypto_test

import (
	"context"
	"errors"
	"testing"

	"github.com/kiramopay/backend/internal/crypto"
	"github.com/shopspring/decimal"
)

// El costo promedio del activo es lo que la pantalla usa para la ganancia, y la
// pantalla lo lee en dolares. La compra lo promediaba con el precio en la
// moneda del pago: una compra en colones metia 500.000 donde las de dolares
// ponian 1.000, y la ganancia de la cartera salia como una perdida del 99,8 %.
// El feed cotiza a 1000 dolares y el tipo de cambio es 500.
func TestCostoPromedio_SiempreEnDolares(t *testing.T) {
	m := montarVenta(t)
	ctx := context.Background()

	compra, err := m.svc.Buy(ctx, m.userID, &crypto.BuyRequest{
		Asset: "BTC", FromCurrency: "CRC", FromAmount: d(50000),
	})
	if err != nil {
		t.Fatalf("comprar en colones: %v", err)
	}
	// El movimiento sigue anotado en la moneda del pago: eso no cambia.
	if !compra.Price.Equal(d(500000)) || compra.Currency != "CRC" {
		t.Fatalf("compra anotada a %s %s, se esperaba 500000 CRC", compra.Price, compra.Currency)
	}
	costo := func() string {
		t.Helper()
		var avg string
		if err := m.pool.QueryRow(ctx,
			`SELECT avg_cost::text FROM crypto_assets WHERE user_id = $1::uuid AND symbol = 'BTC'`,
			m.userID).Scan(&avg); err != nil {
			t.Fatalf("leer el costo promedio: %v", err)
		}
		return avg
	}
	if got := costo(); !d(1000).Equal(decimal.RequireFromString(got)) {
		t.Fatalf("costo promedio tras comprar en colones = %s, se esperaba 1000 (dolares)", got)
	}

	if _, err := m.svc.Buy(ctx, m.userID, &crypto.BuyRequest{
		Asset: "BTC", FromCurrency: "USD", FromAmount: d(100),
	}); err != nil {
		t.Fatalf("comprar en dolares: %v", err)
	}
	if got := costo(); !d(1000).Equal(decimal.RequireFromString(got)) {
		t.Fatalf("costo promedio tras las dos compras = %s, se esperaba 1000", got)
	}
}

// USDT salio del programa de staking. Pedir una posicion nueva se rechaza sin
// tocar nada, pero una que ya existiera se sigue listando y se puede retirar:
// quitar la oferta no es quedarse con lo apartado.
func TestStaking_ActivoRetiradoNoSeOfrecePeroSeRetira(t *testing.T) {
	m := montarVenta(t)
	ctx := context.Background()

	var posicion string
	if err := m.pool.QueryRow(ctx,
		`INSERT INTO crypto_staking (user_id, asset, amount, apy, status)
		 VALUES ($1::uuid, 'USDT', 50, 8, 'active') RETURNING id::text`,
		m.userID).Scan(&posicion); err != nil {
		t.Fatalf("sembrar la posicion vieja: %v", err)
	}

	if _, err := m.svc.Stake(ctx, m.userID, &crypto.StakeRequest{Asset: "USDT", Amount: d(1)}); !errors.Is(err, crypto.ErrStakingNoDisponible) {
		t.Fatalf("stakear USDT = %v, se esperaba ErrStakingNoDisponible", err)
	}
	if n := m.contar(t, `SELECT COUNT(*) FROM crypto_staking WHERE user_id = $1::uuid`, m.userID); n != 1 {
		t.Fatalf("posiciones = %d, el rechazo no debia crear ninguna", n)
	}

	posiciones, err := m.svc.GetStakingPositions(ctx, m.userID)
	if err != nil {
		t.Fatalf("listar posiciones: %v", err)
	}
	if len(posiciones) != 1 || posiciones[0].ID != posicion {
		t.Fatalf("posiciones listadas = %+v, se esperaba la de USDT", posiciones)
	}

	if err := m.svc.Unstake(ctx, m.userID, posicion); err != nil {
		t.Fatalf("retirar la posicion vieja: %v", err)
	}
	var saldo string
	if err := m.pool.QueryRow(ctx,
		`SELECT balance::text FROM crypto_assets WHERE user_id = $1::uuid AND symbol = 'USDT'`,
		m.userID).Scan(&saldo); err != nil {
		t.Fatalf("leer el saldo devuelto: %v", err)
	}
	if !d(50).Equal(decimal.RequireFromString(saldo)) {
		t.Fatalf("USDT devuelto = %s, se esperaba 50", saldo)
	}
	if n := m.contar(t,
		`SELECT COUNT(*) FROM crypto_staking WHERE id = $1::uuid AND status = 'completed'`, posicion); n != 1 {
		t.Fatal("la posicion retirada no quedo completada")
	}
	// Retirarla otra vez dice que ya no esta activa, con su propio sentinela.
	if err := m.svc.Unstake(ctx, m.userID, posicion); !errors.Is(err, crypto.ErrPosicionNoActiva) {
		t.Fatalf("segundo retiro = %v, se esperaba ErrPosicionNoActiva", err)
	}
}
