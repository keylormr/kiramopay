package crypto_test

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/kiramopay/backend/internal/crypto"
	"github.com/kiramopay/backend/internal/ledger"
	"github.com/kiramopay/backend/internal/testutil"
	"github.com/kiramopay/backend/internal/transaction"
	"github.com/kiramopay/backend/internal/wallet"
	"github.com/kiramopay/backend/pkg/hash"
	"github.com/shopspring/decimal"
)

// d is a terse helper for decimal literals in test fixtures.
func d(f float64) decimal.Decimal { return decimal.NewFromFloat(f) }

// stubPriceAt is the price startPriceStub serves for the id in position i of
// the query. Las pruebas comparan contra esta funcion en vez de contra un
// numero suelto, para que el stub y lo que se espera no se separen.
func stubPriceAt(i int) float64 { return 1000 * float64(i+1) }

// startPriceStub serves the CoinGecko simple/price shape from memory, so the
// suite never leaves the machine. La respuesta se arma con los ids que pide el
// servicio, asi que sirve para cualquier simbolo sin tocar el stub.
func startPriceStub(t *testing.T) *httptest.Server {
	t.Helper()

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body := make(map[string]map[string]float64)
		for i, id := range strings.Split(r.URL.Query().Get("ids"), ",") {
			if id == "" {
				continue
			}
			// Precios distintos por id: si el servicio cruzara un simbolo con
			// otro, la prueba lo delataria en vez de pasar por casualidad.
			body[id] = map[string]float64{
				"usd":            stubPriceAt(i),
				"usd_24h_change": 1.5,
				"usd_24h_vol":    2_000_000,
				"usd_market_cap": 3_000_000,
			}
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(body)
	}))
	t.Cleanup(srv.Close)

	return srv
}

func setupCryptoService(t *testing.T) (*crypto.Service, string) {
	t.Helper()
	return montarCripto(t, startPriceStub(t).URL)
}

// setupCryptoServiceSinPrecios apunta el feed a un servidor que no devuelve
// nada, que es como se ve un proveedor caido o rechazando la clave.
func setupCryptoServiceSinPrecios(t *testing.T) (*crypto.Service, string) {
	t.Helper()
	vacio := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte("{}"))
	}))
	t.Cleanup(vacio.Close)
	return montarCripto(t, vacio.URL)
}

func montarCripto(t *testing.T, urlPrecios string) (*crypto.Service, string) {
	t.Helper()
	pool := testutil.TestDB(t)

	repo := crypto.NewRepository(pool)
	priceService := crypto.NewPriceService()
	priceService.SetBaseURL(urlPrecios)
	txRepo := transaction.NewRepository(pool)
	walletRepo := wallet.NewRepository(pool)
	l := ledger.NewEngine(pool, slog.New(slog.NewJSONHandler(os.Stdout, nil)))
	txService := transaction.NewService(txRepo, walletRepo, l, nil)
	// Tipo de cambio fijo: las pruebas cotizan en colones y necesitan el mismo
	// numero siempre para poder afirmar cantidades exactas.
	svc := crypto.NewService(repo, priceService, txService,
		func(context.Context, string, string) (float64, error) { return 500, nil })

	pinHash, _ := hash.HashPin("1234")
	userID := testutil.SeedTestUser(t, pool, "702650930", pinHash)

	// Crypto buys now debit fiat through the ledger; give the wallet enough
	// balance and limit headroom for the purchases exercised below.
	if _, err := pool.Exec(context.Background(),
		`UPDATE wallets SET balance_crc = 1000000000000,
		        daily_limit = 1000000000000, monthly_limit = 1000000000000
		 WHERE user_id = $1::uuid`, userID); err != nil {
		t.Fatalf("top up wallet: %v", err)
	}

	return svc, userID
}

func TestGetPrices(t *testing.T) {
	svc, _ := setupCryptoService(t)

	prices, err := svc.GetPrices(context.Background(), []string{"BTC", "ETH", "SOL"})
	if err != nil {
		t.Fatalf("GetPrices() error: %v", err)
	}
	if len(prices) != 3 {
		t.Fatalf("expected 3 prices, got %d", len(prices))
	}

	btc, ok := prices["BTC"]
	if !ok {
		t.Fatal("BTC not found in prices")
	}
	// El precio exacto del stub, no solo "positivo". Un precio real de CoinGecko
	// tambien es positivo: si alguien desconecta el servidor de prueba y la
	// suite vuelve a salir a internet, con "> 0" pasaria igual y volveriamos al
	// fallo intermitente sin enterarnos. Asi falla de una.
	if want := stubPriceAt(0); btc.Price != want {
		t.Fatalf("BTC price = %f, want %f from the stub", btc.Price, want)
	}
}

func TestBuy_Success(t *testing.T) {
	svc, userID := setupCryptoService(t)
	ctx := context.Background()

	// El cliente solo dice cuanta plata gasta. La cantidad de cripto y el precio
	// los pone el servidor: 1000 USD del stub por 500 de tipo de cambio son
	// 500.000 CRC la unidad, asi que 50.000 CRC compran 0,1.
	tx, err := svc.Buy(ctx, userID, &crypto.BuyRequest{
		Asset:        "BTC",
		FromCurrency: "CRC",
		FromAmount:   d(50000),
	})
	if err != nil {
		t.Fatalf("Buy() error: %v", err)
	}
	if tx.Type != "buy" {
		t.Fatalf("expected type buy, got %s", tx.Type)
	}
	if tx.Asset != "BTC" {
		t.Fatalf("expected asset BTC, got %s", tx.Asset)
	}
	if !tx.Price.Equal(d(500000)) {
		t.Fatalf("precio = %s, esperaba 500000 (el del servidor)", tx.Price)
	}
	if !tx.Amount.Equal(d(0.1)) {
		t.Fatalf("cantidad = %s, esperaba 0.1", tx.Amount)
	}
}

// El corazon del arreglo: lo que el cliente diga de cantidad y precio da igual.
// Antes, "debitame 50.000 y acreditame 1000 BTC" se ejecutaba tal cual.
func TestBuy_IgnoraLaCantidadYElPrecioDelCliente(t *testing.T) {
	svc, userID := setupCryptoService(t)
	ctx := context.Background()

	tx, err := svc.Buy(ctx, userID, &crypto.BuyRequest{
		Asset:        "BTC",
		Amount:       d(1000),   // absurdo, a proposito
		Price:        d(500000), // el del servidor, para pasar la guarda de desvio
		FromCurrency: "CRC",
		FromAmount:   d(50000),
	})
	if err != nil {
		t.Fatalf("Buy() error: %v", err)
	}
	if !tx.Amount.Equal(d(0.1)) {
		t.Fatalf("se acredito %s BTC: la cantidad del cliente mando", tx.Amount)
	}

	activos, err := svc.GetAssets(ctx, userID)
	if err != nil {
		t.Fatalf("GetAssets() error: %v", err)
	}
	for _, a := range activos {
		if a.Symbol == "BTC" && !a.Balance.Equal(d(0.1)) {
			t.Fatalf("saldo BTC = %s, esperaba 0.1", a.Balance)
		}
	}
}

// Un precio muy lejos del real se rechaza en vez de ejecutarse: protege a la
// persona de un cambio brusco y frena una peticion armada a mano.
func TestBuy_RechazaUnPrecioQueNoEsElDelMercado(t *testing.T) {
	svc, userID := setupCryptoService(t)

	_, err := svc.Buy(context.Background(), userID, &crypto.BuyRequest{
		Asset:        "BTC",
		Price:        d(1), // el mercado dice 500000
		FromCurrency: "CRC",
		FromAmount:   d(50000),
	})
	if !errors.Is(err, crypto.ErrPrecioMovido) {
		t.Fatalf("Buy con precio inventado = %v, esperaba ErrPrecioMovido", err)
	}
}

// Sin precio no se opera. Es la consecuencia deliberada: cotizar sin precio es
// justamente lo que se esta corrigiendo.
func TestBuy_SinPrecioNoOpera(t *testing.T) {
	svc, userID := setupCryptoServiceSinPrecios(t)

	_, err := svc.Buy(context.Background(), userID, &crypto.BuyRequest{
		Asset:        "BTC",
		FromCurrency: "CRC",
		FromAmount:   d(50000),
	})
	if !errors.Is(err, crypto.ErrSinPrecio) {
		t.Fatalf("Buy sin precio = %v, esperaba ErrSinPrecio", err)
	}
}

func TestSell_Success(t *testing.T) {
	svc, userID := setupCryptoService(t)
	ctx := context.Background()

	// 3.000.000 CRC a 500.000 la unidad son 6 ETH.
	_, err := svc.Buy(ctx, userID, &crypto.BuyRequest{
		Asset:        "ETH",
		FromCurrency: "CRC",
		FromAmount:   d(3000000),
	})
	if err != nil {
		t.Fatalf("Buy() error: %v", err)
	}

	// Vender 0,5 devuelve 250.000 CRC, lo diga el cliente o no.
	tx, err := svc.Sell(ctx, userID, &crypto.SellRequest{
		Asset:      "ETH",
		Amount:     d(0.5),
		ToCurrency: "CRC",
		ToAmount:   d(999999999), // el cliente pide una fortuna: se ignora
	})
	if err != nil {
		t.Fatalf("Sell() error: %v", err)
	}
	if tx.Type != "sell" {
		t.Fatalf("expected type sell, got %s", tx.Type)
	}
	if !tx.Total.Equal(d(250000)) {
		t.Fatalf("acreditado = %s, esperaba 250000: el monto del cliente mando", tx.Total)
	}
}

func TestGetAssets_Empty(t *testing.T) {
	svc, userID := setupCryptoService(t)
	ctx := context.Background()

	assets, err := svc.GetAssets(ctx, userID)
	if err != nil {
		t.Fatalf("GetAssets() error: %v", err)
	}
	if len(assets) != 0 {
		t.Fatalf("expected 0 assets for new user, got %d", len(assets))
	}
}

func TestGetAssets_AfterBuy(t *testing.T) {
	svc, userID := setupCryptoService(t)
	ctx := context.Background()

	_, err := svc.Buy(ctx, userID, &crypto.BuyRequest{
		Asset:        "BTC",
		FromCurrency: "CRC",
		FromAmount:   d(25000000),
	})
	if err != nil {
		t.Fatalf("Buy() error: %v", err)
	}

	assets, err := svc.GetAssets(ctx, userID)
	if err != nil {
		t.Fatalf("GetAssets() error: %v", err)
	}
	if len(assets) < 1 {
		t.Fatal("expected at least 1 asset after buy")
	}
}

func TestStake_Success(t *testing.T) {
	svc, userID := setupCryptoService(t)
	ctx := context.Background()

	// Fund the asset first (staking requires an existing balance).
	if _, err := svc.Buy(ctx, userID, &crypto.BuyRequest{
		Asset: "ETH", Amount: d(2.0), Price: d(3000000), FromCurrency: "CRC", FromAmount: d(6000000),
	}); err != nil {
		t.Fatalf("seed buy: %v", err)
	}

	staking, err := svc.Stake(ctx, userID, &crypto.StakeRequest{
		Asset:    "ETH",
		Amount:   d(2.0),
		APY:      5.5,
		Locked:   true,
		LockDays: 30,
	})
	if err != nil {
		t.Fatalf("Stake() error: %v", err)
	}
	if staking.Asset != "ETH" {
		t.Fatalf("expected asset ETH, got %s", staking.Asset)
	}
	if staking.Status != "active" {
		t.Fatalf("expected status active, got %s", staking.Status)
	}
}

func TestUnstake_Success(t *testing.T) {
	svc, userID := setupCryptoService(t)
	ctx := context.Background()

	if _, err := svc.Buy(ctx, userID, &crypto.BuyRequest{
		Asset: "SOL", Amount: d(10.0), Price: d(50000), FromCurrency: "CRC", FromAmount: d(500000),
	}); err != nil {
		t.Fatalf("seed buy: %v", err)
	}

	staking, err := svc.Stake(ctx, userID, &crypto.StakeRequest{
		Asset:  "SOL",
		Amount: d(10.0),
		APY:    7.0,
	})
	if err != nil {
		t.Fatalf("Stake() error: %v", err)
	}

	err = svc.Unstake(ctx, userID, staking.ID)
	if err != nil {
		t.Fatalf("Unstake() error: %v", err)
	}
}

func TestPriceAlert_CRUD(t *testing.T) {
	svc, userID := setupCryptoService(t)
	ctx := context.Background()

	// Add alert
	alert, err := svc.AddPriceAlert(ctx, userID, &crypto.PriceAlertRecord{
		Asset:       "BTC",
		TargetPrice: d(100000),
		Direction:   "above",
	})
	if err != nil {
		t.Fatalf("AddPriceAlert() error: %v", err)
	}

	// List alerts
	alerts, err := svc.GetPriceAlerts(ctx, userID)
	if err != nil {
		t.Fatalf("GetPriceAlerts() error: %v", err)
	}
	if len(alerts) != 1 {
		t.Fatalf("expected 1 alert, got %d", len(alerts))
	}

	// Remove alert
	err = svc.RemovePriceAlert(ctx, userID, alert.ID)
	if err != nil {
		t.Fatalf("RemovePriceAlert() error: %v", err)
	}

	// Verify removed
	alerts, err = svc.GetPriceAlerts(ctx, userID)
	if err != nil {
		t.Fatalf("GetPriceAlerts() after remove error: %v", err)
	}
	if len(alerts) != 0 {
		t.Fatalf("expected 0 alerts after remove, got %d", len(alerts))
	}
}

func TestBuy_DecimalPrecision_Exact(t *testing.T) {
	svc, userID := setupCryptoService(t)
	ctx := context.Background()

	// The classic float trap: 0.1 + 0.2 == 0.30000000000000004 in float64.
	// With decimal end-to-end the stored balance must be EXACTLY 0.3.
	for _, amt := range []float64{0.1, 0.2} {
		if _, err := svc.Buy(ctx, userID, &crypto.BuyRequest{
			Asset: "BTC", Amount: d(amt), Price: d(1), FromCurrency: "CRC", FromAmount: d(1000),
		}); err != nil {
			t.Fatalf("buy %v: %v", amt, err)
		}
	}

	assets, err := svc.GetAssets(ctx, userID)
	if err != nil {
		t.Fatalf("GetAssets() error: %v", err)
	}
	var btc *crypto.AssetRecord
	for i := range assets {
		if assets[i].Symbol == "BTC" {
			btc = &assets[i]
			break
		}
	}
	if btc == nil {
		t.Fatal("BTC asset not found")
	}
	want := decimal.RequireFromString("0.3")
	if !btc.Balance.Equal(want) {
		t.Fatalf("balance = %s, want exactly 0.3 (float drift?)", btc.Balance.String())
	}
}

func TestGetTransactions_AfterBuySell(t *testing.T) {
	svc, userID := setupCryptoService(t)
	ctx := context.Background()

	// Buy
	_, _ = svc.Buy(ctx, userID, &crypto.BuyRequest{
		Asset: "BTC", Amount: d(0.1), Price: d(50000000), FromCurrency: "CRC", FromAmount: d(5000000),
	})
	// Sell
	_, _ = svc.Sell(ctx, userID, &crypto.SellRequest{
		Asset: "BTC", Amount: d(0.05), Price: d(50000000), ToCurrency: "CRC", ToAmount: d(2500000),
	})

	txs, err := svc.GetTransactions(ctx, userID)
	if err != nil {
		t.Fatalf("GetTransactions() error: %v", err)
	}
	if len(txs) < 2 {
		t.Fatalf("expected at least 2 crypto transactions, got %d", len(txs))
	}
}
