package crypto_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	"github.com/kiramopay/backend/internal/contract"
	"github.com/kiramopay/backend/internal/crypto"
	"github.com/kiramopay/backend/internal/middleware"
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

// movimientosDeStaking lee, del historial que ve la pantalla, las filas de
// apartar y de retirar.
func movimientosDeStaking(t *testing.T, m *montajeVenta) []crypto.TransactionRecord {
	t.Helper()
	todos, err := m.svc.GetTransactions(context.Background(), m.userID)
	if err != nil {
		t.Fatalf("leer el historial: %v", err)
	}
	var deStaking []crypto.TransactionRecord
	for _, mov := range todos {
		if mov.Type == "stake" || mov.Type == "unstake" {
			deStaking = append(deStaking, mov)
		}
	}
	return deStaking
}

func saldoDelActivo(t *testing.T, m *montajeVenta, simbolo string) decimal.Decimal {
	t.Helper()
	var saldo string
	if err := m.pool.QueryRow(context.Background(),
		`SELECT balance::text FROM crypto_assets WHERE user_id = $1::uuid AND symbol = $2`,
		m.userID, simbolo).Scan(&saldo); err != nil {
		t.Fatalf("leer el saldo de %s: %v", simbolo, err)
	}
	return decimal.RequireFromString(saldo)
}

// "Transacciones recientes" se arma solo con crypto_transactions, y apartar o
// retirar no anotaba nada ahi: el activo salia del saldo y volvia sin que el
// historial lo explicara. La pantalla reemplaza su lista con la del servidor
// al abrir y tras cada operacion, asi que el rastro desaparecia a los segundos.
func TestStaking_ApartarYRetirarQuedanEnElHistorial(t *testing.T) {
	m := montarVenta(t)
	ctx := context.Background()
	if err := crypto.NewRepository(m.pool).UpsertAsset(ctx, m.userID, "ETH", "Ethereum", d(3), d(1000)); err != nil {
		t.Fatalf("sembrar ETH: %v", err)
	}

	posicion, err := m.svc.Stake(ctx, m.userID, &crypto.StakeRequest{Asset: "ETH", Amount: d(2)})
	if err != nil {
		t.Fatalf("stakear: %v", err)
	}
	movs := movimientosDeStaking(t, m)
	if len(movs) != 1 {
		t.Fatalf("movimientos de staking tras apartar = %d, se esperaba 1", len(movs))
	}
	alta := movs[0]
	if alta.Type != "stake" || alta.Asset != "ETH" || !alta.Amount.Equal(d(2)) ||
		!alta.Total.Equal(d(2)) || alta.Currency != "ETH" ||
		!alta.Price.IsZero() || !alta.Fee.IsZero() || alta.Status != "completed" {
		t.Fatalf("movimiento del alta = %+v", alta)
	}

	if err := m.svc.Unstake(ctx, m.userID, posicion.ID); err != nil {
		t.Fatalf("retirar: %v", err)
	}
	movs = movimientosDeStaking(t, m)
	if len(movs) != 2 {
		t.Fatalf("movimientos de staking tras retirar = %d, se esperaba 2", len(movs))
	}
	// El historial va del mas nuevo al mas viejo.
	retiro := movs[0]
	if retiro.Type != "unstake" || retiro.Asset != "ETH" || !retiro.Amount.Equal(d(2)) ||
		!retiro.Total.Equal(d(2)) || retiro.Currency != "ETH" || !retiro.Price.IsZero() {
		t.Fatalf("movimiento del retiro = %+v", retiro)
	}

	// Un segundo retiro se rechaza y no anota otra devolucion.
	if err := m.svc.Unstake(ctx, m.userID, posicion.ID); !errors.Is(err, crypto.ErrPosicionNoActiva) {
		t.Fatalf("segundo retiro = %v, se esperaba ErrPosicionNoActiva", err)
	}
	if n := len(movimientosDeStaking(t, m)); n != 2 {
		t.Fatalf("movimientos tras el segundo retiro = %d, se esperaba 2", n)
	}
	if got := saldoDelActivo(t, m, "ETH"); !got.Equal(d(3)) {
		t.Fatalf("ETH = %s, se esperaba 3", got)
	}

	// Lo que la pantalla pide por HTTP trae las dos filas y cumple el contrato.
	req := httptest.NewRequest(http.MethodGet, urlHistorial, nil)
	req = req.WithContext(context.WithValue(req.Context(), middleware.UserIDKey, m.userID))
	rec := httptest.NewRecorder()
	m.h.GetTransactions(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("historial = %d: %s", rec.Code, rec.Body.String())
	}
	var envelope struct {
		Success bool            `json:"success"`
		Data    json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &envelope); err != nil || !envelope.Success {
		t.Fatalf("respuesta inesperada: %s", rec.Body.String())
	}
	var filas []struct {
		Type     string `json:"type"`
		Amount   string `json:"amount"`
		Currency string `json:"currency"`
	}
	if err := json.Unmarshal(envelope.Data, &filas); err != nil {
		t.Fatalf("leer el historial: %v", err)
	}
	if len(filas) != 2 || filas[0].Type != "unstake" || filas[1].Type != "stake" || filas[0].Currency != "ETH" {
		t.Fatalf("historial por HTTP = %+v", filas)
	}
	// El decimal viaja como texto, igual que en compra y venta.
	if cantidad, err := decimal.NewFromString(filas[0].Amount); err != nil || !cantidad.Equal(d(2)) {
		t.Fatalf("cantidad del retiro por HTTP = %q, se esperaba 2", filas[0].Amount)
	}
	doc, err := contract.LoadSpec("../../docs/openapi.yaml")
	if err != nil {
		t.Fatalf("cargar el contrato: %v", err)
	}
	router, err := contract.NewRouter(doc)
	if err != nil {
		t.Fatalf("router del contrato: %v", err)
	}
	var data interface{}
	if err := json.Unmarshal(envelope.Data, &data); err != nil {
		t.Fatalf("decodificar data: %v", err)
	}
	if err := contract.ValidateData(router, http.MethodGet, urlHistorial, http.StatusOK, data); err != nil {
		t.Errorf("el historial no cumple el contrato: %v", err)
	}
}

const urlHistorial = "http://localhost:8080/api/v1/crypto/transactions"

// La anotacion va dentro de la transaccion: si no se puede anotar, ni se
// aparta ni se retira. Un movimiento de saldo sin fila en el historial es
// justo lo que se esta cerrando.
func TestStaking_SinAnotacionNoSeMueveNada(t *testing.T) {
	m := montarVenta(t)
	ctx := context.Background()
	if err := crypto.NewRepository(m.pool).UpsertAsset(ctx, m.userID, "ETH", "Ethereum", d(3), d(1000)); err != nil {
		t.Fatalf("sembrar ETH: %v", err)
	}

	quitar := m.inyectarFallo(t, fallaAlAnotar)
	if _, err := m.svc.Stake(ctx, m.userID, &crypto.StakeRequest{Asset: "ETH", Amount: d(2)}); err == nil {
		t.Fatal("stakear sin poder anotar respondio exito")
	}
	if got := saldoDelActivo(t, m, "ETH"); !got.Equal(d(3)) {
		t.Fatalf("ETH tras el alta fallida = %s, se esperaba 3", got)
	}
	if n := m.contar(t, `SELECT COUNT(*) FROM crypto_staking WHERE user_id = $1::uuid`, m.userID); n != 0 {
		t.Fatalf("posiciones tras el alta fallida = %d, se esperaba 0", n)
	}
	quitar()

	posicion, err := m.svc.Stake(ctx, m.userID, &crypto.StakeRequest{Asset: "ETH", Amount: d(2)})
	if err != nil {
		t.Fatalf("stakear: %v", err)
	}

	m.inyectarFallo(t, fallaAlAnotar)
	if err := m.svc.Unstake(ctx, m.userID, posicion.ID); err == nil {
		t.Fatal("retirar sin poder anotar respondio exito")
	}
	if got := saldoDelActivo(t, m, "ETH"); !got.Equal(d(1)) {
		t.Fatalf("ETH tras el retiro fallido = %s, se esperaba 1", got)
	}
	if n := m.contar(t,
		`SELECT COUNT(*) FROM crypto_staking WHERE id = $1::uuid AND status = 'active'`, posicion.ID); n != 1 {
		t.Fatal("el retiro fallido cerro la posicion")
	}
	if n := m.contar(t,
		`SELECT COUNT(*) FROM crypto_transactions WHERE user_id = $1::uuid AND type = 'unstake'`, m.userID); n != 0 {
		t.Fatalf("retiros anotados tras el fallo = %d, se esperaba 0", n)
	}
}

// Varios retiros a la vez de la misma posicion: uno solo libera, y uno solo
// queda anotado.
func TestStaking_RetirosSimultaneosAnotanUnaVez(t *testing.T) {
	m := montarVenta(t)
	ctx := context.Background()
	if err := crypto.NewRepository(m.pool).UpsertAsset(ctx, m.userID, "SOL", "Solana", d(5), d(100)); err != nil {
		t.Fatalf("sembrar SOL: %v", err)
	}
	posicion, err := m.svc.Stake(ctx, m.userID, &crypto.StakeRequest{Asset: "SOL", Amount: d(5)})
	if err != nil {
		t.Fatalf("stakear: %v", err)
	}

	const intentos = 6
	var wg sync.WaitGroup
	errs := make([]error, intentos)
	for i := 0; i < intentos; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			errs[i] = m.svc.Unstake(ctx, m.userID, posicion.ID)
		}(i)
	}
	wg.Wait()

	exitos := 0
	for _, err := range errs {
		switch {
		case err == nil:
			exitos++
		case errors.Is(err, crypto.ErrPosicionNoActiva):
		default:
			t.Fatalf("retiro simultaneo con error inesperado: %v", err)
		}
	}
	if exitos != 1 {
		t.Fatalf("retiros exitosos = %d, se esperaba 1", exitos)
	}
	if n := m.contar(t,
		`SELECT COUNT(*) FROM crypto_transactions WHERE user_id = $1::uuid AND type = 'unstake'`, m.userID); n != 1 {
		t.Fatalf("retiros anotados = %d, se esperaba 1", n)
	}
	if got := saldoDelActivo(t, m, "SOL"); !got.Equal(d(5)) {
		t.Fatalf("SOL = %s, se esperaba 5", got)
	}
}
