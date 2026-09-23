package contract_test

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/kiramopay/backend/internal/contract"
	"github.com/kiramopay/backend/internal/crypto"
	"github.com/kiramopay/backend/internal/plans"
	"github.com/kiramopay/backend/pkg/response"
	"github.com/shopspring/decimal"
)

// Contrato de cripto (23-09-2026). Mismo patron que planes_contract_test.go:
// cada caso arma el valor con los tipos que escriben los handlers
// (internal/crypto/handler.go), nunca con un mapa a mano, para que un campo
// que el backend agregue o quite y el esquema no rompa aqui.
//
// Los codigos y estados de los rechazos se copian a mano de donde se
// deciden: rechazoConocido en internal/crypto/errores.go, errorDePrecio en
// internal/crypto/handler.go y errorDeAlerta en internal/crypto/alertas.go.
// Los tres son unexported y no se pueden llamar desde este paquete, asi que
// cada respuesta se arma con response.Error/response.ErrorConDetalle, igual
// que ya hace TestErroresDeTope_CumplenElContrato en planes_contract_test.go.

func d(s string) decimal.Decimal {
	dec, err := decimal.NewFromString(s)
	if err != nil {
		panic(err)
	}
	return dec
}

// ── Las cuatro lecturas: precios, activos, movimientos y staking ──────────

func TestCryptoPrices_CumpleElContrato(t *testing.T) {
	router := routerDeLaSpec(t)
	precios := map[string]crypto.PriceData{
		"BTC": {Symbol: "BTC", Price: 65000.12, Change24h: 1.85, Volume24h: 2_000_000, MarketCap: 3_000_000},
	}
	if err := contract.ValidateData(router, http.MethodGet, base+"/api/v1/crypto/prices", http.StatusOK,
		comoJSON(t, precios)); err != nil {
		t.Fatalf("GET /crypto/prices viola el esquema: %v", err)
	}
}

func TestCryptoAssets_CumpleElContrato(t *testing.T) {
	router := routerDeLaSpec(t)
	ahora := time.Now().UTC()
	activos := []crypto.AssetRecord{
		{ID: unUUID, UserID: unUUID, Symbol: "BTC", Name: "Bitcoin", Balance: d("0.5"), AvgCost: d("65000"),
			CreatedAt: ahora, UpdatedAt: ahora},
	}
	if err := contract.ValidateData(router, http.MethodGet, base+"/api/v1/crypto/assets", http.StatusOK,
		comoJSON(t, activos)); err != nil {
		t.Fatalf("GET /crypto/assets viola el esquema: %v", err)
	}
}

func TestCryptoTransactions_CumpleElContrato(t *testing.T) {
	router := routerDeLaSpec(t)
	ahora := time.Now().UTC()
	movs := []crypto.TransactionRecord{
		{ID: unUUID, UserID: unUUID, Type: "buy", Asset: "BTC", Amount: d("0.1"), Price: d("65000"),
			Total: d("6500"), Currency: "CRC", Fee: decimal.Zero, Status: "completed", CreatedAt: ahora},
		{ID: otroUUID, UserID: unUUID, Type: "send", Asset: "BTC", Amount: d("0.1"), Price: d("65000"),
			Total: d("0.10025"), Currency: "BTC", Fee: d("0.00025"), Status: "completed", CreatedAt: ahora,
			CounterpartyUserID: otroUUID, CounterpartyName: "Victor Lobo"},
	}
	if err := contract.ValidateData(router, http.MethodGet, base+"/api/v1/crypto/transactions", http.StatusOK,
		comoJSON(t, movs)); err != nil {
		t.Fatalf("GET /crypto/transactions viola el esquema: %v", err)
	}
}

// ── Comprar, vender, convertir: las tres que devuelven un movimiento ──────

func TestCryptoBuySellConvert_CumplenElContrato(t *testing.T) {
	router := routerDeLaSpec(t)
	ahora := time.Now().UTC()

	compra := crypto.TransactionRecord{
		ID: unUUID, UserID: unUUID, Type: "buy", Asset: "BTC", Amount: d("0.1"), Price: d("65000"),
		Total: d("6500"), Currency: "CRC", Fee: decimal.Zero, Status: "completed", CreatedAt: ahora,
	}
	if err := contract.ValidateData(router, http.MethodPost, base+"/api/v1/crypto/buy", http.StatusCreated,
		comoJSON(t, compra)); err != nil {
		t.Errorf("POST /crypto/buy 201 viola el esquema: %v", err)
	}

	venta := compra
	venta.Type = "sell"
	if err := contract.ValidateData(router, http.MethodPost, base+"/api/v1/crypto/sell", http.StatusCreated,
		comoJSON(t, venta)); err != nil {
		t.Errorf("POST /crypto/sell 201 viola el esquema: %v", err)
	}

	conversion := crypto.TransactionRecord{
		ID: unUUID, UserID: unUUID, Type: "convert", Asset: "BTC→ETH", Amount: d("0.1"), Price: d("2400"),
		Total: d("1.5"), Currency: "ETH", Fee: decimal.Zero, Status: "completed", CreatedAt: ahora,
	}
	if err := contract.ValidateData(router, http.MethodPost, base+"/api/v1/crypto/convert", http.StatusCreated,
		comoJSON(t, conversion)); err != nil {
		t.Errorf("POST /crypto/convert 201 viola el esquema: %v", err)
	}
}

// ── Enviar entre personas: cotizar y enviar ────────────────────────────────

func TestCryptoSend_CumpleElContrato(t *testing.T) {
	router := routerDeLaSpec(t)
	ahora := time.Now().UTC()

	vista := crypto.SendPreview{
		RecipientName: "Victor Lobo", Asset: "BTC", Amount: d("0.1"), Fee: d("0.00025"),
		Total: d("0.10025"), FeePercent: d("0.25"),
	}
	if err := contract.ValidateData(router, http.MethodPost, base+"/api/v1/crypto/send/preview", http.StatusOK,
		comoJSON(t, vista)); err != nil {
		t.Errorf("POST /crypto/send/preview 200 viola el esquema: %v", err)
	}

	envio := crypto.TransactionRecord{
		ID: unUUID, UserID: unUUID, Type: "send", Asset: "BTC", Amount: d("0.1"), Price: d("65000"),
		Total: d("0.10025"), Currency: "BTC", Fee: d("0.00025"), Status: "completed", CreatedAt: ahora,
		CounterpartyUserID: otroUUID, CounterpartyName: "Victor Lobo",
	}
	if err := contract.ValidateData(router, http.MethodPost, base+"/api/v1/crypto/send", http.StatusCreated,
		comoJSON(t, envio)); err != nil {
		t.Errorf("POST /crypto/send 201 viola el esquema: %v", err)
	}
}

// ── Staking: listar, abrir y retirar ───────────────────────────────────────

func TestCryptoStaking_CumpleElContrato(t *testing.T) {
	router := routerDeLaSpec(t)
	ahora := time.Now().UTC()

	posicion := crypto.StakingRecord{
		ID: unUUID, UserID: unUUID, Asset: "ETH", Amount: d("1"), APY: 4.5, StartDate: ahora,
		Locked: true, LockDays: 30, Earned: decimal.Zero, Status: "active", CreatedAt: ahora,
	}
	if err := contract.ValidateData(router, http.MethodGet, base+"/api/v1/crypto/staking", http.StatusOK,
		comoJSON(t, []crypto.StakingRecord{posicion})); err != nil {
		t.Errorf("GET /crypto/staking viola el esquema: %v", err)
	}

	if err := contract.ValidateData(router, http.MethodPost, base+"/api/v1/crypto/staking", http.StatusCreated,
		comoJSON(t, posicion)); err != nil {
		t.Errorf("POST /crypto/staking 201 viola el esquema: %v", err)
	}

	// NoContent no escribe cuerpo (ver pkg/response.NoContent): el 204 real
	// llega sin bytes, no con un "{}" ni ningun otro cuerpo vacio.
	if err := contract.ValidateResponseBody(router, http.MethodDelete, base+"/api/v1/crypto/staking/"+unUUID,
		http.StatusNoContent, nil); err != nil {
		t.Errorf("DELETE /crypto/staking/{id} 204 viola el esquema: %v", err)
	}
}

// ── Alertas de precio: listar, crear y quitar ──────────────────────────────

func TestCryptoAlerts_CumpleElContrato(t *testing.T) {
	router := routerDeLaSpec(t)
	ahora := time.Now().UTC()
	cumplidaEn := ahora.Add(-time.Hour)
	precioCumplido := d("70000")

	activa := crypto.PriceAlertRecord{
		ID: unUUID, UserID: unUUID, Asset: "BTC", TargetPrice: d("70000"), Direction: "above",
		Active: true, Status: crypto.AlertaActiva, CreatedAt: ahora,
	}
	cumplida := crypto.PriceAlertRecord{
		ID: otroUUID, UserID: unUUID, Asset: "ETH", TargetPrice: d("2000"), Direction: "below",
		Active: false, Status: crypto.AlertaCumplida, CreatedAt: ahora,
		TriggeredAt: &cumplidaEn, TriggeredPrice: &precioCumplido,
	}
	if err := contract.ValidateData(router, http.MethodGet, base+"/api/v1/crypto/alerts", http.StatusOK,
		comoJSON(t, []crypto.PriceAlertRecord{activa, cumplida})); err != nil {
		t.Errorf("GET /crypto/alerts viola el esquema: %v", err)
	}

	if err := contract.ValidateData(router, http.MethodPost, base+"/api/v1/crypto/alerts", http.StatusCreated,
		comoJSON(t, activa)); err != nil {
		t.Errorf("POST /crypto/alerts 201 viola el esquema: %v", err)
	}

	if err := contract.ValidateResponseBody(router, http.MethodDelete, base+"/api/v1/crypto/alerts/"+unUUID,
		http.StatusNoContent, nil); err != nil {
		t.Errorf("DELETE /crypto/alerts/{id} 204 viola el esquema: %v", err)
	}

	// El tope de 20 alertas activas tiene esquema PROPIO (PriceAlertLimitError,
	// no el ErrorResponse generico): exige details con plan/limite/actuales y
	// additionalProperties:false. Es la misma forma que ya prueba
	// TestErroresDeTope_CumplenElContrato para tarjetas y metas de ahorro.
	rec := httptest.NewRecorder()
	tope := &plans.TopeAlcanzadoError{Plan: plans.PlanFree, Limite: crypto.AlertasActivasMaximas, Actuales: crypto.AlertasActivasMaximas}
	response.ErrorConDetalle(rec, http.StatusConflict, "ALERT_LIMIT_REACHED",
		"you already have the maximum number of active price alerts", tope.Detalle())
	if err := contract.ValidateResponseBody(router, http.MethodPost, base+"/api/v1/crypto/alerts",
		http.StatusConflict, rec.Body.Bytes()); err != nil {
		t.Errorf("POST /crypto/alerts 409 ALERT_LIMIT_REACHED viola el esquema: %v", err)
	}

	sinDetalle := httptest.NewRecorder()
	response.Error(sinDetalle, http.StatusConflict, "ALERT_LIMIT_REACHED",
		"you already have the maximum number of active price alerts")
	if err := contract.ValidateResponseBody(router, http.MethodPost, base+"/api/v1/crypto/alerts",
		http.StatusConflict, sinDetalle.Body.Bytes()); err == nil {
		t.Error("POST /crypto/alerts: un 409 de ALERT_LIMIT_REACHED sin details paso el contrato")
	}
}

// ── Los rechazos con el sobre generico ErrorResponse ───────────────────────
//
// code y message son texto libre en el esquema (ApiError no los acota): lo
// que prueba esta tabla es que el spec documenta, en cada ruta, el ESTADO de
// cada rechazo que esa ruta puede responder. ValidateResponseBody falla si el
// spec no menciona ese estado para esa ruta. La tabla no lee los handlers: si
// uno empieza a responder un estado nuevo, la fila se agrega a mano.
//
// PRICE_UNAVAILABLE, PRICE_STALE y CRYPTO_SEND_UNAVAILABLE van con estado
// 503: response.Error tapa el mensaje en cualquier 5xx (ver pkg/response) y
// lo reemplaza por uno generico, asi que el texto de abajo no es el que de
// verdad le llega al cliente — igual que con el resto de la tabla, el
// esquema no exige un texto en particular.
func TestCryptoErrores_CumplenElContrato(t *testing.T) {
	router := routerDeLaSpec(t)
	casos := []struct {
		nombre  string
		metodo  string
		ruta    string
		estado  int
		codigo  string
		mensaje string
	}{
		{"comprar: monto invalido", http.MethodPost, "/api/v1/crypto/buy", http.StatusBadRequest,
			"CRYPTO_INVALID_AMOUNT", "invalid amount"},
		{"comprar: moneda no soportada", http.MethodPost, "/api/v1/crypto/buy", http.StatusBadRequest,
			"UNSUPPORTED_CURRENCY", "unsupported fiat currency"},
		{"comprar: bloqueado por el motor de riesgo", http.MethodPost, "/api/v1/crypto/buy", http.StatusBadRequest,
			"BUY_FAILED", "this transaction was blocked by the risk engine"},
		{"comprar: el precio se movio", http.MethodPost, "/api/v1/crypto/buy", http.StatusConflict,
			"PRICE_MOVED", "el precio cambio desde que se mostro: en pantalla 65000.00 USD, ahora 70000.00 USD"},
		{"comprar: llave reutilizada", http.MethodPost, "/api/v1/crypto/buy", http.StatusConflict,
			"LLAVE_REUTILIZADA", "idempotency key reused for a different movement"},
		{"comprar: no alcanza el saldo fiat", http.MethodPost, "/api/v1/crypto/buy", http.StatusUnprocessableEntity,
			"INSUFFICIENT_BALANCE", "insufficient balance"},
		{"comprar: pasa el tope diario", http.MethodPost, "/api/v1/crypto/buy", http.StatusUnprocessableEntity,
			"DAILY_LIMIT_EXCEEDED", "daily spending limit exceeded"},
		{"comprar: pasa el tope mensual", http.MethodPost, "/api/v1/crypto/buy", http.StatusUnprocessableEntity,
			"MONTHLY_LIMIT_EXCEEDED", "monthly spending limit exceeded"},
		{"comprar: hace falta MFA", http.MethodPost, "/api/v1/crypto/buy", http.StatusPreconditionRequired,
			"MFA_REQUIRED", "verified MFA challenge required for this amount"},
		{"comprar: no hay precio", http.MethodPost, "/api/v1/crypto/buy", http.StatusServiceUnavailable,
			"PRICE_UNAVAILABLE", "no market price available for this asset: BTC"},

		{"vender: monto invalido", http.MethodPost, "/api/v1/crypto/sell", http.StatusBadRequest,
			"CRYPTO_INVALID_AMOUNT", "invalid amount"},
		{"vender: no alcanza el activo", http.MethodPost, "/api/v1/crypto/sell", http.StatusUnprocessableEntity,
			"CRYPTO_INSUFFICIENT_BALANCE", "insufficient asset balance"},
		{"vender: el precio se movio", http.MethodPost, "/api/v1/crypto/sell", http.StatusConflict,
			"PRICE_MOVED", "el precio cambio desde que se mostro: en pantalla 65000.00 USD, ahora 70000.00 USD"},
		{"vender: precio viejo", http.MethodPost, "/api/v1/crypto/sell", http.StatusServiceUnavailable,
			"PRICE_STALE", "crypto price is too old to trade on"},

		{"cotizar envio: codigo invalido", http.MethodPost, "/api/v1/crypto/send/preview", http.StatusBadRequest,
			"QR_INVALIDO", "ese codigo no existe o ya no es valido"},
		{"cotizar envio: codigo revocado", http.MethodPost, "/api/v1/crypto/send/preview", http.StatusConflict,
			"QR_REVOCADO", "ese codigo fue retirado por su dueno"},
		{"cotizar envio: codigo de comercio", http.MethodPost, "/api/v1/crypto/send/preview", http.StatusUnprocessableEntity,
			"QR_DE_COMERCIO", "ese codigo es de un comercio: los comercios cobran en colones o dolares"},
		{"cotizar envio: codigo de un cobro", http.MethodPost, "/api/v1/crypto/send/preview", http.StatusUnprocessableEntity,
			"QR_DE_COBRO", "ese codigo es un cobro en dinero: pagalo desde Pagar con QR"},
		{"cotizar envio: sin resolver QR", http.MethodPost, "/api/v1/crypto/send/preview", http.StatusServiceUnavailable,
			"CRYPTO_SEND_UNAVAILABLE", "enviar cripto no esta disponible"},

		{"enviar: a uno mismo", http.MethodPost, "/api/v1/crypto/send", http.StatusBadRequest,
			"CRYPTO_SEND_SELF", "no podes enviarte cripto a vos mismo"},
		{"enviar: llave de otro envio", http.MethodPost, "/api/v1/crypto/send", http.StatusConflict,
			"LLAVE_REUTILIZADA", "esa operacion ya se hizo con otro monto o para otra persona"},
		{"enviar: no alcanza para el monto mas la comision", http.MethodPost, "/api/v1/crypto/send", http.StatusUnprocessableEntity,
			"CRYPTO_INSUFFICIENT_BALANCE", "insufficient asset balance"},
		{"enviar: hace falta MFA", http.MethodPost, "/api/v1/crypto/send", http.StatusPreconditionRequired,
			"MFA_REQUIRED", "verified MFA challenge required for this amount"},
		{"enviar: no hay precio", http.MethodPost, "/api/v1/crypto/send", http.StatusServiceUnavailable,
			"PRICE_UNAVAILABLE", "no market price available for this asset: BTC"},

		{"convertir: monto invalido", http.MethodPost, "/api/v1/crypto/convert", http.StatusBadRequest,
			"CRYPTO_INVALID_AMOUNT", "invalid amount"},
		{"convertir: llave de otra operacion", http.MethodPost, "/api/v1/crypto/convert", http.StatusConflict,
			"LLAVE_REUTILIZADA", "esa operacion ya se hizo con otro monto o con otro activo"},
		{"convertir: no alcanza el origen", http.MethodPost, "/api/v1/crypto/convert", http.StatusUnprocessableEntity,
			"CRYPTO_INSUFFICIENT_BALANCE", "insufficient asset balance"},
		{"convertir: no hay precio", http.MethodPost, "/api/v1/crypto/convert", http.StatusServiceUnavailable,
			"PRICE_UNAVAILABLE", "no market price available for this asset: ETH"},
		{"convertir: precio viejo", http.MethodPost, "/api/v1/crypto/convert", http.StatusServiceUnavailable,
			"PRICE_STALE", "crypto price is too old to trade on"},

		{"apartar: activo fuera del programa", http.MethodPost, "/api/v1/crypto/staking", http.StatusBadRequest,
			"STAKING_NOT_AVAILABLE", "staking is not available for this asset"},
		{"apartar: llave de otro apartado", http.MethodPost, "/api/v1/crypto/staking", http.StatusConflict,
			"LLAVE_REUTILIZADA", "esa operacion ya se hizo con otro monto o con otro activo"},
		{"apartar: el apartado de esa llave ya se retiro", http.MethodPost, "/api/v1/crypto/staking", http.StatusConflict,
			"STAKING_ALREADY_WITHDRAWN", "staking with this idempotency key was already withdrawn"},
		{"apartar: no alcanza el activo", http.MethodPost, "/api/v1/crypto/staking", http.StatusUnprocessableEntity,
			"CRYPTO_INSUFFICIENT_BALANCE", "insufficient asset balance"},

		{"retirar: la posicion no existe", http.MethodDelete, "/api/v1/crypto/staking/" + unUUID, http.StatusNotFound,
			"STAKING_POSITION_NOT_FOUND", "staking position not found"},
		{"retirar: ya estaba retirada", http.MethodDelete, "/api/v1/crypto/staking/" + unUUID, http.StatusConflict,
			"STAKING_POSITION_INACTIVE", "staking position is not active"},
		{"retirar: el plazo no vencio", http.MethodDelete, "/api/v1/crypto/staking/" + unUUID, http.StatusConflict,
			"STAKING_POSITION_LOCKED", "position is locked until 2026-10-23"},

		{"crear alerta: activo no cotizado", http.MethodPost, "/api/v1/crypto/alerts", http.StatusBadRequest,
			"ALERT_UNSUPPORTED_ASSET", "price alert: unsupported asset"},
		{"crear alerta: direccion invalida", http.MethodPost, "/api/v1/crypto/alerts", http.StatusBadRequest,
			"ALERT_INVALID_DIRECTION", "price alert: direction must be above or below"},
		{"crear alerta: precio fuera de rango", http.MethodPost, "/api/v1/crypto/alerts", http.StatusBadRequest,
			"ALERT_PRICE_OUT_OF_RANGE", "price alert: target price out of range"},
		{"crear alerta: ya cumplida", http.MethodPost, "/api/v1/crypto/alerts", http.StatusBadRequest,
			"ALERT_ALREADY_MET", "price alert: the current price already meets the target"},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			rec := httptest.NewRecorder()
			response.Error(rec, c.estado, c.codigo, c.mensaje)
			if err := contract.ValidateResponseBody(router, c.metodo, base+c.ruta, c.estado, rec.Body.Bytes()); err != nil {
				t.Errorf("%s %s (%d %s) viola el esquema: %v", c.metodo, c.ruta, c.estado, c.codigo, err)
			}
		})
	}
}
