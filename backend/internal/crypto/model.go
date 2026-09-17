package crypto

import (
	"time"

	"github.com/shopspring/decimal"
)

// Crypto asset quantities and per-unit prices are NUMERIC(38,18) in the DB and
// decimal.Decimal in Go — never float64. decimal.UnmarshalJSON parses the JSON
// numeric literal exactly (no float round-trip), so the JSON contract with the
// frontend is unchanged: it still sends and receives plain numbers.

// User's crypto holdings
type AssetRecord struct {
	ID        string          `json:"id"`
	UserID    string          `json:"user_id"`
	Symbol    string          `json:"symbol"`   // BTC, ETH, SOL, etc.
	Name      string          `json:"name"`     // Bitcoin, Ethereum, etc.
	Balance   decimal.Decimal `json:"balance"`  // Crypto amount
	AvgCost   decimal.Decimal `json:"avg_cost"` // Costo promedio por unidad, SIEMPRE en USD
	CreatedAt time.Time       `json:"created_at"`
	UpdatedAt time.Time       `json:"updated_at"`
}

type TransactionRecord struct {
	ID        string          `json:"id"`
	UserID    string          `json:"user_id"`
	Type      string          `json:"type"`     // buy, sell, convert, stake, unstake
	Asset     string          `json:"asset"`    // Symbol
	Amount    decimal.Decimal `json:"amount"`   // Crypto amount
	Price     decimal.Decimal `json:"price"`    // Por unidad: en Currency (compra, venta), en USD (conversion) o cero (staking)
	Total     decimal.Decimal `json:"total"`    // Fiat movido al centimo, lo recibido en una conversion o lo apartado/liberado en staking
	Currency  string          `json:"currency"` // Moneda del Total: USD, CRC o un simbolo (destino de la conversion, activo del staking)
	Fee       decimal.Decimal `json:"fee"`
	Status    string          `json:"status"`
	CreatedAt time.Time       `json:"created_at"`
}

type StakingRecord struct {
	ID        string          `json:"id"`
	UserID    string          `json:"user_id"`
	Asset     string          `json:"asset"`
	Amount    decimal.Decimal `json:"amount"`
	APY       float64         `json:"apy"` // rate, NUMERIC(8,4); precision non-critical
	StartDate time.Time       `json:"start_date"`
	Locked    bool            `json:"locked"`
	LockDays  int             `json:"lock_days,omitempty"`
	Earned    decimal.Decimal `json:"earned"`
	Status    string          `json:"status"` // active, completed, cancelled
	CreatedAt time.Time       `json:"created_at"`
}

// Estados de una alerta de precio, tal como los ve el cliente. Ver la
// migracion 071 para como se derivan de las columnas.
const (
	AlertaActiva   = "active"
	AlertaCumplida = "triggered"
)

type PriceAlertRecord struct {
	ID          string          `json:"id"`
	UserID      string          `json:"user_id"`
	Asset       string          `json:"asset"`
	TargetPrice decimal.Decimal `json:"target_price"` // USD, la moneda del feed
	Direction   string          `json:"direction"`    // above, below
	Active      bool            `json:"active"`
	// Status es AlertaActiva o AlertaCumplida. Las quitadas no salen en
	// ninguna lista.
	Status    string    `json:"status"`
	CreatedAt time.Time `json:"created_at"`
	// TriggeredAt y TriggeredPrice: cuando y con que precio (USD) la cumplio el
	// barrido. Nulos mientras la alerta esta activa.
	TriggeredAt    *time.Time       `json:"triggered_at,omitempty"`
	TriggeredPrice *decimal.Decimal `json:"triggered_price,omitempty"`
}

// CrearAlertaRequest es lo unico que el cliente decide de una alerta. El resto
// (id, dueno, estado, fechas) lo pone el servidor.
type CrearAlertaRequest struct {
	Asset       string          `json:"asset"`
	TargetPrice decimal.Decimal `json:"target_price"`
	Direction   string          `json:"direction"`
}

// API request/response types

type BuyRequest struct {
	Asset          string          `json:"asset"`
	Amount         decimal.Decimal `json:"amount"` // crypto quantity bought
	Price          decimal.Decimal `json:"price"`
	FromCurrency   string          `json:"from_currency"`
	FromAmount     decimal.Decimal `json:"from_amount"` // fiat paid
	IdempotencyKey string          `json:"idempotency_key,omitempty"`
}

type SellRequest struct {
	Asset          string          `json:"asset"`
	Amount         decimal.Decimal `json:"amount"` // crypto quantity sold
	Price          decimal.Decimal `json:"price"`
	ToCurrency     string          `json:"to_currency"`
	ToAmount       decimal.Decimal `json:"to_amount"` // fiat received
	IdempotencyKey string          `json:"idempotency_key,omitempty"`
}

type ConvertRequest struct {
	FromAsset  string          `json:"from_asset"`
	ToAsset    string          `json:"to_asset"`
	FromAmount decimal.Decimal `json:"from_amount"`
	ToAmount   decimal.Decimal `json:"to_amount"`
	Price      decimal.Decimal `json:"price"`
}

type StakeRequest struct {
	Asset    string          `json:"asset"`
	Amount   decimal.Decimal `json:"amount"`
	APY      float64         `json:"apy"` // ignored: the rate is set server-side (see stakingAPY)
	Locked   bool            `json:"locked"`
	LockDays int             `json:"lock_days,omitempty"`
}

// Price data from external API (transient; not persisted as NUMERIC).
type PriceData struct {
	Symbol    string  `json:"symbol"`
	Price     float64 `json:"price"`
	Change24h float64 `json:"change_24h"`
	Volume24h float64 `json:"volume_24h"`
	MarketCap float64 `json:"market_cap"`
	// High24h y Low24h: reales, tal como los da /coins/markets. Antes el
	// feed (/simple/price) no los traia y el frontend los ESTIMABA a mano
	// desde change_24h (ver el comentario de cabecera de cryptoPrices.ts).
	// omitempty: si el proveedor no los trae, no se inventa un numero.
	High24h float64 `json:"high_24h,omitempty"`
	Low24h  float64 `json:"low_24h,omitempty"`
	// Sparkline7d: precios aproximadamente horarios de los ultimos 7 dias,
	// tal como CoinGecko los da en sparkline_in_7d.price. Vacio cuando el
	// proveedor no los trajo (respuesta parcial, simbolo sin datos): la
	// regla de este servicio es no inventar un historial, ni con un random
	// walk ni con una linea plana.
	Sparkline7d []float64 `json:"sparkline_7d,omitempty"`
}
