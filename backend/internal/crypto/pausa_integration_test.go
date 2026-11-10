package crypto_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/kiramopay/backend/internal/crypto"
	"github.com/kiramopay/backend/internal/middleware"
)

// La pausa de produccion (ver pausa.go): frena lo que abre una posicion, no lo
// que deja salir de ella, y no le quita la respuesta a un reintento.

const (
	consultaMovimientos = `SELECT COUNT(*) FROM crypto_transactions WHERE user_id = $1::uuid`
	consultaPosiciones  = `SELECT COUNT(*) FROM crypto_staking WHERE user_id = $1::uuid`
)

func (m *montajeVenta) enPausa(t *testing.T) *crypto.Service {
	t.Helper()
	return servicioDeVentaCon(t, m.pool, m.urlPrecios, &crypto.Opciones{ComprasEnPausa: true})
}

func (m *montajeVenta) marcarDemo(t *testing.T) {
	t.Helper()
	if _, err := m.pool.Exec(context.Background(),
		`UPDATE users SET demo_login = TRUE WHERE id = $1::uuid`, m.userID); err != nil {
		t.Fatalf("marcar la cuenta de demostracion: %v", err)
	}
}

func TestPausa_FrenaComprarConvertirYApartar(t *testing.T) {
	m := montarVenta(t)
	m.sembrar(t, "BTC", "Bitcoin", 2)
	m.sembrar(t, "ETH", "Ethereum", 2)
	svc := m.enPausa(t)
	ctx := context.Background()
	crcAntes, usdAntes := m.billetera(t)

	_, errCompra := svc.Buy(ctx, m.userID, &crypto.BuyRequest{Asset: "BTC", FromCurrency: "CRC", FromAmount: d(50000)})
	_, errConvertir := svc.Convert(ctx, m.userID, &crypto.ConvertRequest{FromAsset: "BTC", ToAsset: "ETH", FromAmount: d(1)})
	_, errApartar := svc.Stake(ctx, m.userID, &crypto.StakeRequest{Asset: "ETH", Amount: d(1)})

	for nombre, err := range map[string]error{"comprar": errCompra, "convertir": errConvertir, "apartar": errApartar} {
		if !errors.Is(err, crypto.ErrComprasEnPausa) {
			t.Errorf("%s: se esperaba la pausa, salio %v", nombre, err)
		}
	}
	if crc, usd := m.billetera(t); crc != crcAntes || usd != usdAntes {
		t.Errorf("la billetera cambio: %d/%d -> %d/%d", crcAntes, usdAntes, crc, usd)
	}
	if n := m.contar(t, consultaMovimientos, m.userID); n != 0 {
		t.Errorf("quedaron %d movimientos", n)
	}
	if n := m.contar(t, consultaPosiciones, m.userID); n != 0 {
		t.Errorf("quedaron %d posiciones", n)
	}

	rec := m.porHTTP(urlConvertir, crypto.NewHandler(svc).Convert, convertirUnBTC)
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("por HTTP salio %d: %s", rec.Code, rec.Body.String())
	}
	var cuerpo struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &cuerpo); err != nil {
		t.Fatalf("respuesta: %v", err)
	}
	if cuerpo.Error.Code != "CRYPTO_PAUSED" {
		t.Errorf("codigo: %q", cuerpo.Error.Code)
	}
}

func TestPausa_DejaVenderYRetirarDelStaking(t *testing.T) {
	m := montarVenta(t)
	m.sembrar(t, "ETH", "Ethereum", 3)
	ctx := context.Background()

	posicion, err := m.svc.Stake(ctx, m.userID, &crypto.StakeRequest{Asset: "ETH", Amount: d(1)})
	if err != nil {
		t.Fatalf("apartar antes de la pausa: %v", err)
	}

	svc := m.enPausa(t)
	if _, err := svc.Sell(ctx, m.userID, &crypto.SellRequest{Asset: "ETH", Amount: d(1), ToCurrency: "CRC"}); err != nil {
		t.Errorf("vender en pausa: %v", err)
	}
	if err := svc.Unstake(ctx, m.userID, posicion.ID); err != nil {
		t.Errorf("retirar en pausa: %v", err)
	}
}

func TestPausa_LaCuentaDeDemostracionSigueAbierta(t *testing.T) {
	m := montarVenta(t)
	m.sembrar(t, "ETH", "Ethereum", 2)
	m.marcarDemo(t)
	svc := m.enPausa(t)
	ctx := context.Background()

	if _, err := svc.Buy(ctx, m.userID, &crypto.BuyRequest{Asset: "BTC", FromCurrency: "CRC", FromAmount: d(50000)}); err != nil {
		t.Errorf("comprar: %v", err)
	}
	if _, err := svc.Convert(ctx, m.userID, &crypto.ConvertRequest{FromAsset: "ETH", ToAsset: "BTC", FromAmount: d(0.5)}); err != nil {
		t.Errorf("convertir: %v", err)
	}
	if _, err := svc.Stake(ctx, m.userID, &crypto.StakeRequest{Asset: "ETH", Amount: d(0.5)}); err != nil {
		t.Errorf("apartar: %v", err)
	}
}

// La respuesta se perdio justo antes de la pausa y el telefono reintenta: lo
// que ya se hizo se contesta, sin abrir nada mas.
func TestPausa_ContestaElReintentoDeLoYaHecho(t *testing.T) {
	m := montarVenta(t)
	m.sembrar(t, "BTC", "Bitcoin", 2)
	m.sembrar(t, "ETH", "Ethereum", 2)
	ctx := context.Background()

	compra := crypto.BuyRequest{Asset: "BTC", FromCurrency: "CRC", FromAmount: d(50000), IdempotencyKey: "crypto:buy:toque-1"}
	conversion := crypto.ConvertRequest{FromAsset: "BTC", ToAsset: "ETH", FromAmount: d(1), IdempotencyKey: "crypto:convert:toque-1"}
	apartado := crypto.StakeRequest{Asset: "ETH", Amount: d(1), IdempotencyKey: "crypto:stake:toque-1"}

	primeraCompra, primeraConversion, primerApartado := compra, conversion, apartado
	if _, err := m.svc.Buy(ctx, m.userID, &primeraCompra); err != nil {
		t.Fatalf("comprar: %v", err)
	}
	if _, err := m.svc.Convert(ctx, m.userID, &primeraConversion); err != nil {
		t.Fatalf("convertir: %v", err)
	}
	if _, err := m.svc.Stake(ctx, m.userID, &primerApartado); err != nil {
		t.Fatalf("apartar: %v", err)
	}
	movimientos := m.contar(t, consultaMovimientos, m.userID)

	svc := m.enPausa(t)
	if _, err := svc.Buy(ctx, m.userID, &compra); err != nil {
		t.Errorf("reintento de la compra: %v", err)
	}
	if _, err := svc.Convert(ctx, m.userID, &conversion); err != nil {
		t.Errorf("reintento de la conversion: %v", err)
	}
	if _, err := svc.Stake(ctx, m.userID, &apartado); err != nil {
		t.Errorf("reintento del apartado: %v", err)
	}
	if n := m.contar(t, consultaMovimientos, m.userID); n != movimientos {
		t.Errorf("el reintento anoto movimientos: %d -> %d", movimientos, n)
	}
	if n := m.contar(t, consultaPosiciones, m.userID); n != 1 {
		t.Errorf("posiciones: %d", n)
	}

	// Una llave nueva ya no pasa.
	nuevo := crypto.StakeRequest{Asset: "ETH", Amount: d(0.1), IdempotencyKey: "crypto:stake:toque-2"}
	if _, err := svc.Stake(ctx, m.userID, &nuevo); !errors.Is(err, crypto.ErrComprasEnPausa) {
		t.Errorf("apartado nuevo: %v", err)
	}
}

func TestPausa_LaPantallaSabeSiEstaAbierta(t *testing.T) {
	m := montarVenta(t)
	abierta := func(svc *crypto.Service) bool {
		t.Helper()
		req := httptest.NewRequest(http.MethodGet, "http://localhost:8080/api/v1/crypto/availability", nil)
		req = req.WithContext(context.WithValue(req.Context(), middleware.UserIDKey, m.userID))
		rec := httptest.NewRecorder()
		crypto.NewHandler(svc).GetAvailability(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("salio %d: %s", rec.Code, rec.Body.String())
		}
		var cuerpo struct {
			Data crypto.Disponibilidad `json:"data"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &cuerpo); err != nil {
			t.Fatalf("respuesta: %v", err)
		}
		return cuerpo.Data.PurchasesActive
	}

	if !abierta(m.svc) {
		t.Error("sin pausa deberia estar abierta")
	}
	pausado := m.enPausa(t)
	if abierta(pausado) {
		t.Error("en pausa deberia estar cerrada")
	}
	m.marcarDemo(t)
	if !abierta(pausado) {
		t.Error("la cuenta de demostracion deberia seguir abierta")
	}
}
