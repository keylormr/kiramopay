package crypto_test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/kiramopay/backend/internal/contract"
	"github.com/kiramopay/backend/internal/crypto"
	"github.com/kiramopay/backend/internal/ledger"
	"github.com/kiramopay/backend/internal/middleware"
	"github.com/kiramopay/backend/internal/testutil"
	"github.com/kiramopay/backend/internal/transaction"
	"github.com/kiramopay/backend/internal/wallet"
	"github.com/kiramopay/backend/pkg/hash"
	"github.com/shopspring/decimal"
)

// Vender cripto nunca funciono en produccion. El 13-09, con 0,00064 BTC en la
// cuenta, vender 0,00001 respondio 400 SELL_FAILED con el texto de Postgres:
// el descuento iba por un INSERT ... ON CONFLICT DO UPDATE con delta negativo,
// y Postgres evalua el CHECK chk_crypto_balance_nonneg (migracion 019) sobre la
// fila que PROPONE el INSERT antes de resolver el conflicto. La CI no lo vio
// porque el esquema de pruebas no tenia ese CHECK.
//
// Estas pruebas cubren la venta de punta a punta contra el esquema de pruebas,
// que ahora lo espeja. El feed cotiza a 1000 dolares y el tipo de cambio es
// 500: una unidad vale 500.000 colones.

const urlVender = "http://localhost:8080/api/v1/crypto/sell"

type montajeVenta struct {
	svc        *crypto.Service
	h          *crypto.Handler
	pool       *pgxpool.Pool
	userID     string
	urlPrecios string
}

// servicioDeVenta arma el servicio real sobre el pool que se le pase. Esta
// aparte de montarVenta porque hay una prueba que necesita un SEGUNDO servicio,
// igual en todo menos en el pool, para mirar por dentro sus consultas.
func servicioDeVenta(t *testing.T, pool *pgxpool.Pool, urlPrecios string) *crypto.Service {
	t.Helper()
	precios := crypto.NewPriceService()
	precios.SetBaseURL(urlPrecios)
	txService := transaction.NewService(
		transaction.NewRepository(pool),
		wallet.NewRepository(pool),
		ledger.NewEngine(pool, slog.New(slog.NewJSONHandler(os.Stdout, nil))),
		nil,
	)
	return crypto.NewService(crypto.NewRepository(pool), precios, txService,
		func(context.Context, string, string) (float64, error) { return 500, nil }, nil)
}

// montarVenta arma el servicio real con acceso al pool. No reusa
// montarCripto porque las pruebas de aqui leen la base directamente, y
// volver a llamar a testutil.TestDB truncaria todo.
func montarVenta(t *testing.T) *montajeVenta {
	t.Helper()
	urlPrecios := startPriceStub(t).URL
	pool := testutil.TestDB(t)
	svc := servicioDeVenta(t, pool, urlPrecios)

	pinHash, _ := hash.HashPin("1234")
	userID := testutil.SeedTestUser(t, pool, "702650930", pinHash)
	if _, err := pool.Exec(context.Background(),
		`UPDATE wallets SET balance_crc = 1000000000000,
		        daily_limit = 1000000000000, monthly_limit = 1000000000000
		 WHERE user_id = $1::uuid`, userID); err != nil {
		t.Fatalf("fondear la billetera: %v", err)
	}
	return &montajeVenta{
		svc: svc, h: crypto.NewHandler(svc), pool: pool, userID: userID, urlPrecios: urlPrecios,
	}
}

func (m *montajeVenta) billetera(t *testing.T) (crc, usd int64) {
	t.Helper()
	if err := m.pool.QueryRow(context.Background(),
		`SELECT balance_crc, balance_usd FROM wallets WHERE user_id = $1::uuid`, m.userID,
	).Scan(&crc, &usd); err != nil {
		t.Fatalf("leer la billetera: %v", err)
	}
	return crc, usd
}

func (m *montajeVenta) contar(t *testing.T, consulta string, args ...any) int {
	t.Helper()
	var n int
	if err := m.pool.QueryRow(context.Background(), consulta, args...).Scan(&n); err != nil {
		t.Fatalf("contar (%s): %v", consulta, err)
	}
	return n
}

func (m *montajeVenta) asientosDeLaLlave(t *testing.T, llave string) int {
	t.Helper()
	return m.contar(t, `SELECT COUNT(*) FROM journal_postings WHERE idempotency_key = $1`, llave)
}

func (m *montajeVenta) ventasAnotadas(t *testing.T) int {
	t.Helper()
	return m.contar(t,
		`SELECT COUNT(*) FROM crypto_transactions WHERE user_id = $1::uuid AND type = 'sell'`, m.userID)
}

// filasDeLaLlave cuenta las filas de `transactions` que cuelgan de la llave.
func (m *montajeVenta) filasDeLaLlave(t *testing.T, llave string) int {
	t.Helper()
	return m.contar(t,
		`SELECT COUNT(*) FROM transactions WHERE user_id = $1::uuid AND idempotency_key = $2`,
		m.userID, llave)
}

// filaDeLaLlave devuelve el id y el estado de la fila de `transactions` que
// cuelga de la llave, y cuantas hay.
func (m *montajeVenta) filaDeLaLlave(t *testing.T, llave string) (id, estado string) {
	t.Helper()
	if n := m.filasDeLaLlave(t, llave); n != 1 {
		t.Fatalf("filas con la llave %q = %d, se esperaba 1", llave, n)
	}
	if err := m.pool.QueryRow(context.Background(),
		`SELECT id::text, status FROM transactions WHERE user_id = $1::uuid AND idempotency_key = $2`,
		m.userID, llave,
	).Scan(&id, &estado); err != nil {
		t.Fatalf("leer la fila de %q: %v", llave, err)
	}
	return id, estado
}

// falla es un disparador que aborta una escritura, con la sentencia que lo
// quita. DROP TRIGGER es tambien la forma de quitar un disparador de
// restriccion.
type falla struct {
	nombre string
	crear  string
	quitar string
}

var (
	fallaAlAnotar = falla{
		nombre: "falla la anotacion del movimiento",
		crear: `CREATE TRIGGER prueba_falla BEFORE INSERT ON crypto_transactions
			FOR EACH ROW EXECUTE FUNCTION prueba_falla_inyectada()`,
		quitar: `DROP TRIGGER IF EXISTS prueba_falla ON crypto_transactions`,
	}
	fallaAlCerrarLaFila = falla{
		nombre: "falla el cierre de la fila del libro",
		crear: `CREATE TRIGGER prueba_falla BEFORE UPDATE ON transactions
			FOR EACH ROW WHEN (NEW.status = 'completed') EXECUTE FUNCTION prueba_falla_inyectada()`,
		quitar: `DROP TRIGGER IF EXISTS prueba_falla ON transactions`,
	}
	fallaAlConfirmar = falla{
		nombre: "falla el commit del asiento",
		crear: `CREATE CONSTRAINT TRIGGER prueba_falla AFTER UPDATE ON crypto_assets
			DEFERRABLE INITIALLY DEFERRED
			FOR EACH ROW EXECUTE FUNCTION prueba_falla_inyectada()`,
		quitar: `DROP TRIGGER IF EXISTS prueba_falla ON crypto_assets`,
	}
)

// inyectarFallo instala la falla y devuelve con que quitarla. Se quita sola al
// terminar la prueba.
func (m *montajeVenta) inyectarFallo(t *testing.T, f falla) (quitar func()) {
	t.Helper()
	ctx := context.Background()
	if _, err := m.pool.Exec(ctx, `
		CREATE OR REPLACE FUNCTION prueba_falla_inyectada() RETURNS trigger
		LANGUAGE plpgsql AS $$
		BEGIN
			RAISE EXCEPTION 'falla inyectada por la prueba';
		END $$`); err != nil {
		t.Fatalf("crear la funcion de la falla: %v", err)
	}
	if _, err := m.pool.Exec(ctx, f.crear); err != nil {
		t.Fatalf("crear el disparador (%s): %v", f.nombre, err)
	}
	quitar = func() {
		ctx := context.Background()
		if _, err := m.pool.Exec(ctx, f.quitar); err != nil {
			t.Errorf("quitar el disparador (%s): %v", f.nombre, err)
		}
		if _, err := m.pool.Exec(ctx, `DROP FUNCTION IF EXISTS prueba_falla_inyectada()`); err != nil {
			t.Errorf("quitar la funcion de la falla: %v", err)
		}
	}
	t.Cleanup(quitar)
	return quitar
}

func (m *montajeVenta) venderPorHTTP(t *testing.T, cuerpo string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, urlVender, strings.NewReader(cuerpo))
	req = req.WithContext(context.WithValue(req.Context(), middleware.UserIDKey, m.userID))
	rec := httptest.NewRecorder()
	m.h.Sell(rec, req)
	return rec
}

// delPreChequeo dice si el rechazo por saldo salio de la comprobacion previa y
// no de la guarda de dentro del asiento.
//
// Las dos responden al mismo errors.Is, asi que el texto es lo unico que las
// separa: el pre-chequeo devuelve el sentinela con el simbolo y nada mas —lo
// arma el servicio antes de tocar la base—, y la guarda lo trae envuelto en los
// prefijos del camino que hizo falta abrir para llegar a ella ("sell ETH: post
// ledger: en la misma tx: ...").
func delPreChequeo(err error, activo string) bool {
	return err != nil && err.Error() == fmt.Sprintf("%s: %s", crypto.ErrSaldoDeActivoInsuficiente, activo)
}

// sinRastroDeLaBase falla si la respuesta deja ver algo de Postgres.
func sinRastroDeLaBase(t *testing.T, cuerpo string) {
	t.Helper()
	for _, filtrado := range []string{"SQLSTATE", "ERROR:", "crypto_assets", "chk_", "violates", "post ledger"} {
		if strings.Contains(cuerpo, filtrado) {
			t.Fatalf("la respuesta deja ver %q: %s", filtrado, cuerpo)
		}
	}
}

// El pedido exacto que fallo en produccion, por HTTP: la cantidad llega como
// texto y el precio es el de la pantalla, en dolares.
func TestVender_ElPedidoQueFallabaEnProduccion(t *testing.T) {
	m := montarVenta(t)
	ctx := context.Background()

	// 50 colones a 500.000 la unidad compran 0,0001 BTC.
	if _, err := m.svc.Buy(ctx, m.userID, &crypto.BuyRequest{
		Asset: "BTC", FromCurrency: "CRC", FromAmount: d(50),
	}); err != nil {
		t.Fatalf("comprar BTC: %v", err)
	}
	crcAntes, _ := m.billetera(t)

	rec := m.venderPorHTTP(t, `{"asset":"BTC","amount":"0.00001","price":"1000","to_currency":"CRC"}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("vender = %d, se esperaba 201: %s", rec.Code, rec.Body.String())
	}

	var envelope struct {
		Success bool            `json:"success"`
		Data    json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &envelope); err != nil || !envelope.Success {
		t.Fatalf("respuesta inesperada: %s", rec.Body.String())
	}
	var venta crypto.TransactionRecord
	if err := json.Unmarshal(envelope.Data, &venta); err != nil {
		t.Fatalf("leer la venta: %v", err)
	}
	// 0,00001 BTC a 500.000 colones: 5 colones.
	if venta.Type != "sell" || venta.Asset != "BTC" || venta.Currency != "CRC" ||
		!venta.Amount.Equal(d(0.00001)) || !venta.Total.Equal(d(5)) || !venta.Price.Equal(d(500000)) {
		t.Fatalf("venta = %+v", venta)
	}
	if got := saldoDeActivo(t, m.svc, m.userID, "BTC"); !got.Equal(decimal.RequireFromString("0.00009")) {
		t.Fatalf("saldo BTC = %s, se esperaba 0.00009", got)
	}
	if crc, _ := m.billetera(t); crc != crcAntes+500 {
		t.Fatalf("billetera CRC = %d, se esperaba %d (500 centimos mas)", crc, crcAntes+500)
	}

	// Y la respuesta cumple el contrato publicado.
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
	if err := contract.ValidateData(router, http.MethodPost, urlVender, http.StatusCreated, data); err != nil {
		t.Errorf("la venta no cumple CryptoTransactionRecord: %v", err)
	}
}

// Vender una parte, primero a colones y despues a dolares: el activo baja, la
// billetera sube al centimo en la moneda pedida, y quedan la venta anotada,
// su fila completada y un solo asiento, los tres con el mismo id.
func TestVender_UnaParteEnColonesYEnDolares(t *testing.T) {
	m := montarVenta(t)
	ctx := context.Background()
	comprarSeisETH(t, m.svc, m.userID)
	crc0, usd0 := m.billetera(t)

	casos := []struct {
		moneda      string
		cantidad    float64
		total       float64
		precio      float64
		saldo       float64
		deltaCRC    int64
		deltaUSD    int64
		idempotente string
	}{
		{"CRC", 0.5, 250000, 500000, 5.5, 25_000_000, 0, "venta-parte-crc"},
		{"USD", 0.25, 250, 1000, 5.25, 25_000_000, 25_000, "venta-parte-usd"},
	}
	for _, c := range casos {
		venta, err := m.svc.Sell(ctx, m.userID, &crypto.SellRequest{
			Asset: "ETH", Amount: d(c.cantidad), Price: d(stubPriceAt(0)),
			ToCurrency: c.moneda, IdempotencyKey: c.idempotente,
		})
		if err != nil {
			t.Fatalf("vender %v ETH a %s: %v", c.cantidad, c.moneda, err)
		}
		if venta.Type != "sell" || venta.Status != "completed" || venta.Currency != c.moneda ||
			!venta.Total.Equal(d(c.total)) || !venta.Price.Equal(d(c.precio)) || !venta.Amount.Equal(d(c.cantidad)) {
			t.Fatalf("venta a %s = %+v", c.moneda, venta)
		}
		if got := saldoDeActivo(t, m.svc, m.userID, "ETH"); !got.Equal(d(c.saldo)) {
			t.Fatalf("saldo ETH tras vender a %s = %s, se esperaba %v", c.moneda, got, c.saldo)
		}
		crc, usd := m.billetera(t)
		if crc != crc0+c.deltaCRC || usd != usd0+c.deltaUSD {
			t.Fatalf("billetera tras vender a %s = %d CRC / %d USD, se esperaba %d / %d",
				c.moneda, crc, usd, crc0+c.deltaCRC, usd0+c.deltaUSD)
		}

		id, estado := m.filaDeLaLlave(t, c.idempotente)
		if id != venta.ID || estado != transaction.StatusCompleted {
			t.Fatalf("fila de %s: id=%s estado=%s, se esperaba id=%s completed", c.moneda, id, estado, venta.ID)
		}
		if n := m.contar(t, `SELECT COUNT(*) FROM journal_postings WHERE tx_id = $1::uuid`, venta.ID); n != 1 {
			t.Fatalf("asientos de la venta a %s = %d, se esperaba 1", c.moneda, n)
		}
		if n := m.contar(t, `SELECT COUNT(*) FROM crypto_transactions WHERE id = $1::uuid`, venta.ID); n != 1 {
			t.Fatalf("anotaciones de la venta a %s = %d, se esperaba 1", c.moneda, n)
		}
	}
	if n := m.ventasAnotadas(t); n != 2 {
		t.Fatalf("ventas anotadas = %d, se esperaba 2", n)
	}
}

// Vender todo deja el activo en cero exacto, sin chocar con el CHECK. Despues
// no queda nada que vender.
func TestVender_TodoElSaldoQuedaEnCero(t *testing.T) {
	m := montarVenta(t)
	ctx := context.Background()
	comprarSeisETH(t, m.svc, m.userID)
	crc0, _ := m.billetera(t)

	venta, err := m.svc.Sell(ctx, m.userID, &crypto.SellRequest{
		Asset: "ETH", Amount: d(6), ToCurrency: "CRC",
	})
	if err != nil {
		t.Fatalf("vender todo: %v", err)
	}
	if !venta.Total.Equal(d(3000000)) {
		t.Fatalf("acreditado = %s, se esperaba 3000000", venta.Total)
	}
	if got := saldoDeActivo(t, m.svc, m.userID, "ETH"); !got.IsZero() {
		t.Fatalf("saldo ETH = %s, se esperaba 0", got)
	}
	if crc, _ := m.billetera(t); crc != crc0+300_000_000 {
		t.Fatalf("billetera CRC = %d, se esperaba %d", crc, crc0+300_000_000)
	}

	_, err = m.svc.Sell(ctx, m.userID, &crypto.SellRequest{
		Asset: "ETH", Amount: d(0.00001), ToCurrency: "CRC", IdempotencyKey: "venta-sobre-cero",
	})
	if !errors.Is(err, crypto.ErrSaldoDeActivoInsuficiente) {
		t.Fatalf("vender con saldo cero = %v, se esperaba ErrSaldoDeActivoInsuficiente", err)
	}
	if got := saldoDeActivo(t, m.svc, m.userID, "ETH"); !got.IsZero() {
		t.Fatalf("saldo ETH = %s tras el rechazo, se esperaba 0", got)
	}
}

// Vender de mas se rechaza con un codigo propio y no mueve nada: ni el activo,
// ni la billetera, ni un asiento, ni una venta anotada, ni una fila en el
// historial.
//
// Con llave del cliente tambien, que es como llega SIEMPRE desde la pantalla.
// Antes, con llave, el pre-chequeo se saltaba y frenaba la guarda de dentro del
// asiento: la misma respuesta, pero despues de abrir una transaccion y dejar
// una fila rotulada 'failed' —visible en el historial general— de una venta que
// nunca movio nada.
func TestVender_DeMasSeRechazaConCodigoPropioYNoMueveNada(t *testing.T) {
	m := montarVenta(t)
	ctx := context.Background()
	comprarSeisETH(t, m.svc, m.userID)
	crc0, usd0 := m.billetera(t)

	pedidos := []*crypto.SellRequest{
		{Asset: "ETH", Amount: d(7), ToCurrency: "CRC"},
		{Asset: "ETH", Amount: d(7), ToCurrency: "CRC", IdempotencyKey: "venta-de-mas"},
		{Asset: "ETH", Amount: d(7), ToCurrency: "USD", IdempotencyKey: "venta-de-mas-usd"},
		// Un activo que nunca se tuvo: descontar no crea la fila.
		{Asset: "BTC", Amount: d(0.1), ToCurrency: "CRC", IdempotencyKey: "venta-sin-activo"},
	}
	for _, p := range pedidos {
		_, err := m.svc.Sell(ctx, m.userID, p)
		if !errors.Is(err, crypto.ErrSaldoDeActivoInsuficiente) {
			t.Fatalf("vender %s %s (llave %q) = %v, se esperaba ErrSaldoDeActivoInsuficiente",
				p.Amount, p.Asset, p.IdempotencyKey, err)
		}
		// Traiga llave o no, el rechazo sale del pre-chequeo: es lo que ahorra
		// el asiento y el rastro. No corta la prueba aca a proposito: si esto
		// falla, lo que sigue —el rastro que quedo— es justo lo que hay que ver.
		if !delPreChequeo(err, p.Asset) {
			t.Errorf("vender %s (llave %q) se rechazo desde dentro del asiento: %v",
				p.Asset, p.IdempotencyKey, err)
		}
		if p.IdempotencyKey == "" {
			continue
		}
		if n := m.asientosDeLaLlave(t, p.IdempotencyKey); n != 0 {
			t.Fatalf("asientos de %q = %d, se esperaba 0", p.IdempotencyKey, n)
		}
		if n := m.filasDeLaLlave(t, p.IdempotencyKey); n != 0 {
			t.Fatalf("filas de %q = %d, se esperaba 0: quedo en el historial una venta que nunca se intento mover",
				p.IdempotencyKey, n)
		}
	}

	if got := saldoDeActivo(t, m.svc, m.userID, "ETH"); !got.Equal(d(6)) {
		t.Fatalf("saldo ETH = %s, se esperaba 6", got)
	}
	if n := m.contar(t,
		`SELECT COUNT(*) FROM crypto_assets WHERE user_id = $1::uuid AND symbol = 'BTC'`, m.userID); n != 0 {
		t.Fatalf("filas de BTC = %d, se esperaba 0", n)
	}
	if crc, usd := m.billetera(t); crc != crc0 || usd != usd0 {
		t.Fatalf("billetera = %d / %d, se esperaba %d / %d", crc, usd, crc0, usd0)
	}
	if n := m.ventasAnotadas(t); n != 0 {
		t.Fatalf("ventas anotadas = %d, se esperaba 0", n)
	}

	// Por HTTP: 422 con su codigo y ni una palabra de la base, con llave y sin
	// ella.
	for _, cuerpo := range []string{
		`{"asset":"ETH","amount":"7","to_currency":"CRC"}`,
		`{"asset":"ETH","amount":"7","to_currency":"CRC","idempotency_key":"venta-de-mas-http"}`,
	} {
		rec := m.venderPorHTTP(t, cuerpo)
		var env struct {
			Error struct {
				Code    string `json:"code"`
				Message string `json:"message"`
			} `json:"error"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &env)
		if rec.Code != http.StatusUnprocessableEntity || env.Error.Code != "CRYPTO_INSUFFICIENT_BALANCE" ||
			env.Error.Message != crypto.ErrSaldoDeActivoInsuficiente.Error() {
			t.Fatalf("%s -> %d %s", cuerpo, rec.Code, rec.Body.String())
		}
		sinRastroDeLaBase(t, rec.Body.String())
	}
	if got := saldoDeActivo(t, m.svc, m.userID, "ETH"); !got.Equal(d(6)) {
		t.Fatalf("saldo ETH tras los rechazos por HTTP = %s, se esperaba 6", got)
	}
}

// Si algo falla despues del descuento —la anotacion, el cierre de la fila o el
// COMMIT del asiento—, se revierte todo: el activo sigue entero y no entra ni
// un centimo. Antes eran pasos sueltos con una compensacion a mano en medio.
// Despues, el reintento con la MISMA llave reusa la fila y vende una sola vez.
func TestVender_UnaFallaAMitadNoDescuentaYElReintentoVendeUnaVez(t *testing.T) {
	for i, c := range []falla{fallaAlAnotar, fallaAlCerrarLaFila, fallaAlConfirmar} {
		t.Run(c.nombre, func(t *testing.T) {
			m := montarVenta(t)
			ctx := context.Background()
			comprarSeisETH(t, m.svc, m.userID)
			crc0, _ := m.billetera(t)
			llave := fmt.Sprintf("venta-con-falla-%d", i)
			pedido := &crypto.SellRequest{
				Asset: "ETH", Amount: d(0.5), ToCurrency: "CRC", IdempotencyKey: llave,
			}

			quitar := m.inyectarFallo(t, c)
			if _, err := m.svc.Sell(ctx, m.userID, pedido); err == nil {
				t.Fatal("la venta se confirmo pese a la falla")
			}
			if got := saldoDeActivo(t, m.svc, m.userID, "ETH"); !got.Equal(d(6)) {
				t.Fatalf("saldo ETH = %s, se esperaba 6: el descuento no se revirtio", got)
			}
			if crc, _ := m.billetera(t); crc != crc0 {
				t.Fatalf("billetera CRC = %d, se esperaba %d: entro dinero de una venta fallida", crc, crc0)
			}
			if n := m.asientosDeLaLlave(t, llave); n != 0 {
				t.Fatalf("asientos = %d, se esperaba 0", n)
			}
			if n := m.ventasAnotadas(t); n != 0 {
				t.Fatalf("ventas anotadas = %d, se esperaba 0", n)
			}
			idFallida, estado := m.filaDeLaLlave(t, llave)
			if estado != transaction.StatusFailed {
				t.Fatalf("fila en %q, se esperaba failed", estado)
			}

			quitar()
			venta, err := m.svc.Sell(ctx, m.userID, pedido)
			if err != nil {
				t.Fatalf("reintento con la misma llave: %v", err)
			}
			if got := saldoDeActivo(t, m.svc, m.userID, "ETH"); !got.Equal(d(5.5)) {
				t.Fatalf("saldo ETH = %s, se esperaba 5.5", got)
			}
			if crc, _ := m.billetera(t); crc != crc0+25_000_000 {
				t.Fatalf("billetera CRC = %d, se esperaba %d", crc, crc0+25_000_000)
			}
			id, estado := m.filaDeLaLlave(t, llave)
			if id != idFallida || id != venta.ID || estado != transaction.StatusCompleted {
				t.Fatalf("fila %s en %q (la fallida era %s, la venta %s): el reintento no reuso la fila",
					id, estado, idFallida, venta.ID)
			}
			if n := m.asientosDeLaLlave(t, llave); n != 1 {
				t.Fatalf("asientos = %d, se esperaba 1", n)
			}
			if n := m.ventasAnotadas(t); n != 1 {
				t.Fatalf("ventas anotadas = %d, se esperaba 1", n)
			}
		})
	}
}

// Repetir una venta que ya confirmo devuelve esa misma venta y no mueve nada
// mas, aunque ya se haya llevado todo el saldo. La misma llave con otra
// cantidad es otra operacion y se rechaza.
func TestVender_ReintentoConLaMismaLlave(t *testing.T) {
	m := montarVenta(t)
	ctx := context.Background()
	comprarSeisETH(t, m.svc, m.userID)
	crc0, _ := m.billetera(t)

	parte := &crypto.SellRequest{Asset: "ETH", Amount: d(0.5), ToCurrency: "CRC", IdempotencyKey: "venta-repetida"}
	primera, err := m.svc.Sell(ctx, m.userID, parte)
	if err != nil {
		t.Fatalf("primera venta: %v", err)
	}
	segunda, err := m.svc.Sell(ctx, m.userID, parte)
	if err != nil {
		t.Fatalf("repeticion: %v", err)
	}
	if segunda.ID != primera.ID || !segunda.Total.Equal(primera.Total) || !segunda.Amount.Equal(primera.Amount) {
		t.Fatalf("la repeticion devolvio otra venta: %+v, la primera fue %+v", segunda, primera)
	}
	if got := saldoDeActivo(t, m.svc, m.userID, "ETH"); !got.Equal(d(5.5)) {
		t.Fatalf("saldo ETH = %s, se esperaba 5.5: la repeticion desconto otra vez", got)
	}
	if crc, _ := m.billetera(t); crc != crc0+25_000_000 {
		t.Fatalf("billetera CRC = %d, se esperaba %d: la repeticion acredito otra vez", crc, crc0+25_000_000)
	}
	if n := m.asientosDeLaLlave(t, "venta-repetida"); n != 1 {
		t.Fatalf("asientos = %d, se esperaba 1", n)
	}

	otraCantidad := &crypto.SellRequest{Asset: "ETH", Amount: d(1), ToCurrency: "CRC", IdempotencyKey: "venta-repetida"}
	if _, err := m.svc.Sell(ctx, m.userID, otraCantidad); !errors.Is(err, transaction.ErrLlaveReutilizada) {
		t.Fatalf("misma llave con otra cantidad = %v, se esperaba ErrLlaveReutilizada", err)
	}
	if got := saldoDeActivo(t, m.svc, m.userID, "ETH"); !got.Equal(d(5.5)) {
		t.Fatalf("saldo ETH = %s tras la llave reusada, se esperaba 5.5", got)
	}

	// La que se lleva todo: repetirla no puede decir "saldo insuficiente".
	todo := &crypto.SellRequest{Asset: "ETH", Amount: d(5.5), ToCurrency: "CRC", IdempotencyKey: "venta-de-todo"}
	primeraDeTodo, err := m.svc.Sell(ctx, m.userID, todo)
	if err != nil {
		t.Fatalf("vender el resto: %v", err)
	}
	repetida, err := m.svc.Sell(ctx, m.userID, todo)
	if err != nil {
		t.Fatalf("repetir la venta del resto = %v, se esperaba la venta original", err)
	}
	if repetida.ID != primeraDeTodo.ID {
		t.Fatalf("la repeticion devolvio %s, la venta fue %s", repetida.ID, primeraDeTodo.ID)
	}
	if crc, _ := m.billetera(t); crc != crc0+25_000_000+275_000_000 {
		t.Fatalf("billetera CRC = %d, se esperaba %d", crc, crc0+25_000_000+275_000_000)
	}
	if n := m.ventasAnotadas(t); n != 2 {
		t.Fatalf("ventas anotadas = %d, se esperaba 2", n)
	}
}

// Una llave que quedo con una fila NO completada vuelve a comprobar el saldo.
//
// El pre-chequeo se salta unicamente para la llave de una venta ya COMPLETADA,
// que es el unico caso en que decir "no alcanza" hablaria de dinero que ya se
// movio. Una fila 'failed' no es eso: su asiento no confirmo, el activo sigue
// entero y el pedido se va a reintentar de verdad sobre esa misma fila. Si esa
// llave se saltara el pre-chequeo, se quedaria abriendo y revirtiendo un
// asiento entero en cada intento para llegar a la misma respuesta.
func TestVender_LaLlaveConFilaFallidaVuelveAComprobarElSaldo(t *testing.T) {
	m := montarVenta(t)
	ctx := context.Background()
	comprarSeisETH(t, m.svc, m.userID)
	llave := "venta-que-quedo-fallida"
	pedido := &crypto.SellRequest{Asset: "ETH", Amount: d(0.5), ToCurrency: "CRC", IdempotencyKey: llave}

	quitar := m.inyectarFallo(t, fallaAlAnotar)
	if _, err := m.svc.Sell(ctx, m.userID, pedido); err == nil {
		t.Fatal("la venta se confirmo pese a la falla")
	}
	quitar()
	if _, estado := m.filaDeLaLlave(t, llave); estado != transaction.StatusFailed {
		t.Fatalf("fila de %q en %q, se esperaba failed", llave, estado)
	}

	// Otra venta se lleva todo: ahora el reintento de la fallida no alcanza.
	if _, err := m.svc.Sell(ctx, m.userID, &crypto.SellRequest{
		Asset: "ETH", Amount: d(6), ToCurrency: "CRC", IdempotencyKey: "venta-que-vacia-el-saldo",
	}); err != nil {
		t.Fatalf("vender todo: %v", err)
	}

	_, err := m.svc.Sell(ctx, m.userID, pedido)
	if !errors.Is(err, crypto.ErrSaldoDeActivoInsuficiente) {
		t.Fatalf("reintento de la fallida = %v, se esperaba ErrSaldoDeActivoInsuficiente", err)
	}
	if !delPreChequeo(err, "ETH") {
		t.Fatalf("el reintento de la fallida volvio a abrir el asiento para decir lo mismo: %v", err)
	}
	if _, estado := m.filaDeLaLlave(t, llave); estado != transaction.StatusFailed {
		t.Fatalf("fila de %q en %q tras el reintento, se esperaba failed", llave, estado)
	}
	if n := m.asientosDeLaLlave(t, llave); n != 0 {
		t.Fatalf("asientos de %q = %d, se esperaba 0", llave, n)
	}
	if n := m.ventasAnotadas(t); n != 1 {
		t.Fatalf("ventas anotadas = %d, se esperaba 1 (solo la que vacio el saldo)", n)
	}
}

// Dos ventas simultaneas que juntas pasan el saldo: las dos pasan la
// comprobacion de cortesia, pero la guarda dentro del asiento deja pasar una.
func TestVender_DosVentasSimultaneasNoVendenMasDeLoQueHay(t *testing.T) {
	m := montarVenta(t)
	ctx := context.Background()
	comprarSeisETH(t, m.svc, m.userID)
	crc0, _ := m.billetera(t)

	var wg sync.WaitGroup
	errs := make([]error, 2)
	for i := range errs {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_, errs[i] = m.svc.Sell(ctx, m.userID, &crypto.SellRequest{
				Asset: "ETH", Amount: d(4), ToCurrency: "CRC",
			})
		}(i)
	}
	wg.Wait()

	exitos := 0
	for _, err := range errs {
		switch {
		case err == nil:
			exitos++
		case !errors.Is(err, crypto.ErrSaldoDeActivoInsuficiente):
			t.Fatalf("la venta perdedora fallo por otra causa: %v", err)
		}
	}
	if exitos != 1 {
		t.Fatalf("ventas exitosas = %d, se esperaba 1 (errs=%v)", exitos, errs)
	}
	if got := saldoDeActivo(t, m.svc, m.userID, "ETH"); !got.Equal(d(2)) {
		t.Fatalf("saldo ETH = %s, se esperaba 2", got)
	}
	if crc, _ := m.billetera(t); crc != crc0+200_000_000 {
		t.Fatalf("billetera CRC = %d, se esperaba %d", crc, crc0+200_000_000)
	}
	if n := m.ventasAnotadas(t); n != 1 {
		t.Fatalf("ventas anotadas = %d, se esperaba 1", n)
	}
}

// La compuerta real del descuento, sin el servicio de por medio.
//
// Hasta el pre-chequeo con llave, las ventas de mas con llave de
// TestVender_DeMasSeRechazaConCodigoPropioYNoMueveNada llegaban hasta aqui y
// era este `balance >= $3` el que las frenaba. Ahora las frena antes el
// servicio, asi que sin esta prueba la guarda se quedaria cubierta solo por la
// carrera de dos ventas simultaneas, que por definicion no garantiza tocarla.
func TestDescuento_LaGuardaFrenaLoQueNoAlcanza(t *testing.T) {
	m := montarVenta(t)
	ctx := context.Background()
	comprarSeisETH(t, m.svc, m.userID)

	tx, err := m.pool.Begin(ctx)
	if err != nil {
		t.Fatalf("abrir la transaccion: %v", err)
	}
	err = crypto.NewRepository(m.pool).VenderEnTx(ctx, tx, &crypto.TransactionRecord{
		UserID: m.userID, Type: "sell", Asset: "ETH", Amount: d(7),
		Price: d(500000), Total: d(3500000), Currency: "CRC", Status: "completed",
	})
	_ = tx.Rollback(ctx)
	if !errors.Is(err, crypto.ErrSaldoDeActivoInsuficiente) {
		t.Fatalf("descontar 7 de 6 = %v, se esperaba ErrSaldoDeActivoInsuficiente", err)
	}

	if got := saldoDeActivo(t, m.svc, m.userID, "ETH"); !got.Equal(d(6)) {
		t.Fatalf("saldo ETH = %s, se esperaba 6", got)
	}
	if n := m.ventasAnotadas(t); n != 0 {
		t.Fatalf("ventas anotadas = %d, se esperaba 0", n)
	}
}

// La causa, sin el servicio de por medio: restar por INSERT ... ON CONFLICT
// choca con el CHECK aunque la fila existente alcance. Si el esquema de
// pruebas pierde el espejo de la 019, esta prueba lo dice antes que produccion.
func TestEsquema_RestarPorUpsertChocaConElCheckAunqueAlcance(t *testing.T) {
	m := montarVenta(t)
	ctx := context.Background()
	comprarSeisETH(t, m.svc, m.userID)

	_, err := m.pool.Exec(ctx,
		`INSERT INTO crypto_assets (user_id, symbol, name, balance, avg_cost)
		 VALUES ($1, 'ETH', 'Ethereum', $2, 0)
		 ON CONFLICT (user_id, symbol) DO UPDATE SET balance = crypto_assets.balance + EXCLUDED.balance`,
		m.userID, d(-0.5))
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) || pgErr.Code != "23514" || pgErr.ConstraintName != "chk_crypto_balance_nonneg" {
		t.Fatalf("restar por upsert = %v, se esperaba el 23514 de chk_crypto_balance_nonneg", err)
	}
	if got := saldoDeActivo(t, m.svc, m.userID, "ETH"); !got.Equal(d(6)) {
		t.Fatalf("saldo ETH = %s, se esperaba 6", got)
	}
}

// ── Comprar ─────────────────────────────────────────────────────────────
//
// El abono de la compra iba despues del asiento y por fuera. Con la venta
// arreglada, eso era una fuente de dinero: repetir una compra con la misma
// llave abonaba el activo otra vez sin cobrar, y ese activo se podia vender.

func TestComprar_RepetirConLaMismaLlaveNoAbonaOtraVez(t *testing.T) {
	m := montarVenta(t)
	ctx := context.Background()
	crc0, _ := m.billetera(t)

	pedido := &crypto.BuyRequest{Asset: "BTC", FromCurrency: "CRC", FromAmount: d(50000), IdempotencyKey: "compra-repetida"}
	primera, err := m.svc.Buy(ctx, m.userID, pedido)
	if err != nil {
		t.Fatalf("comprar: %v", err)
	}
	for i := 0; i < 3; i++ {
		otra, err := m.svc.Buy(ctx, m.userID, pedido)
		if err != nil {
			t.Fatalf("repeticion %d: %v", i, err)
		}
		if otra.ID != primera.ID || !otra.Amount.Equal(primera.Amount) {
			t.Fatalf("repeticion %d devolvio %+v, la compra fue %+v", i, otra, primera)
		}
	}

	if got := saldoDeActivo(t, m.svc, m.userID, "BTC"); !got.Equal(d(0.1)) {
		t.Fatalf("saldo BTC = %s, se esperaba 0.1: la repeticion abono otra vez", got)
	}
	if crc, _ := m.billetera(t); crc != crc0-5_000_000 {
		t.Fatalf("billetera CRC = %d, se esperaba %d", crc, crc0-5_000_000)
	}
	if n := m.contar(t,
		`SELECT COUNT(*) FROM crypto_transactions WHERE user_id = $1::uuid AND type = 'buy'`, m.userID); n != 1 {
		t.Fatalf("compras anotadas = %d, se esperaba 1", n)
	}
	id, estado := m.filaDeLaLlave(t, "compra-repetida")
	if id != primera.ID || estado != transaction.StatusCompleted {
		t.Fatalf("fila %s en %q, la compra fue %s", id, estado, primera.ID)
	}
}

// Si la anotacion de la compra falla, no se cobra ni se abona. Antes el
// cobro y el abono ya estaban hechos cuando la anotacion fallaba.
func TestComprar_SiLaAnotacionFallaNoSeCobraNiSeAbona(t *testing.T) {
	m := montarVenta(t)
	ctx := context.Background()
	crc0, _ := m.billetera(t)

	m.inyectarFallo(t, fallaAlAnotar)
	if _, err := m.svc.Buy(ctx, m.userID, &crypto.BuyRequest{
		Asset: "BTC", FromCurrency: "CRC", FromAmount: d(50000), IdempotencyKey: "compra-con-falla",
	}); err == nil {
		t.Fatal("la compra se confirmo pese a la falla")
	}
	if got := saldoDeActivo(t, m.svc, m.userID, "BTC"); !got.IsZero() {
		t.Fatalf("saldo BTC = %s, se esperaba 0", got)
	}
	if crc, _ := m.billetera(t); crc != crc0 {
		t.Fatalf("billetera CRC = %d, se esperaba %d: se cobro una compra fallida", crc, crc0)
	}
	if n := m.asientosDeLaLlave(t, "compra-con-falla"); n != 0 {
		t.Fatalf("asientos = %d, se esperaba 0", n)
	}
}

// Una llave que ya tiene OTRO movimiento se responde como llave reutilizada,
// aunque el saldo tampoco alcance para el movimiento nuevo.
//
// La comprobacion de cortesia del saldo corre antes de CreateTransaction, asi
// que si pregunta por el saldo pase lo que pase tapa el motivo real: quien
// manda una llave ocupada recibe "no te alcanza" —algo que nadie puede
// arreglar poniendo mas saldo— en lugar del ErrLlaveReutilizada que le dice que
// la llave ya describe otra cosa. El orden de los motivos lo decide la
// relectura de idempotencia; el pre-chequeo no puede adelantarsele.
func TestVender_LaLlaveOcupadaSeRespondeComoTalAunqueElSaldoNoAlcance(t *testing.T) {
	m := montarVenta(t)
	ctx := context.Background()
	comprarSeisETH(t, m.svc, m.userID)
	const llave = "venta-con-llave-ocupada"

	// Una venta que deja la fila de la llave sin completar: su asiento no
	// confirmo, asi que el activo sigue entero y la llave queda ocupada por un
	// movimiento de 0,5 ETH.
	quitar := m.inyectarFallo(t, fallaAlAnotar)
	if _, err := m.svc.Sell(ctx, m.userID, &crypto.SellRequest{
		Asset: "ETH", Amount: d(0.5), ToCurrency: "CRC", IdempotencyKey: llave,
	}); err == nil {
		t.Fatal("la venta se confirmo pese a la falla")
	}
	quitar()
	if _, estado := m.filaDeLaLlave(t, llave); estado != transaction.StatusFailed {
		t.Fatalf("fila de %q en %q, se esperaba failed", llave, estado)
	}

	// Misma llave, otra cantidad, y esa cantidad tampoco cabe en el saldo.
	_, err := m.svc.Sell(ctx, m.userID, &crypto.SellRequest{
		Asset: "ETH", Amount: d(100), ToCurrency: "CRC", IdempotencyKey: llave,
	})
	if errors.Is(err, crypto.ErrSaldoDeActivoInsuficiente) {
		t.Fatalf("la llave ocupada se respondio por saldo: %v", err)
	}
	if !errors.Is(err, transaction.ErrLlaveReutilizada) {
		t.Fatalf("llave ocupada con otra cantidad = %v, se esperaba ErrLlaveReutilizada", err)
	}

	if got := saldoDeActivo(t, m.svc, m.userID, "ETH"); !got.Equal(d(6)) {
		t.Fatalf("saldo ETH = %s, se esperaba 6", got)
	}
	if n := m.filasDeLaLlave(t, llave); n != 1 {
		t.Fatalf("filas con la llave %q = %d, se esperaba 1", llave, n)
	}
	if n := m.ventasAnotadas(t); n != 0 {
		t.Fatalf("ventas anotadas = %d, se esperaba 0", n)
	}
}

// El reintento no puede rechazar por saldo una venta que SI ocurrio.
//
// El pre-chequeo hace DOS lecturas sueltas contra la base, sin transaccion ni
// candado que las una, y la llave del cliente existe justo para el caso en que
// el pedido original sigue en vuelo: la red se corto sin traer la respuesta y
// la pantalla reintenta con la misma llave. Ese pedido original puede confirmar
// ENTRE una lectura y la otra. Si la llave se lee primero, el reintento la ve
// "todavia no completada" y un instante despues ve el saldo YA descontado, y
// contesta "no te alcanza" por una venta que ya se cobro, sin llegar nunca a la
// relectura de idempotencia que le habria devuelto la venta guardada. Leyendo
// el saldo primero eso es imposible: el descuento y el rotulo 'completed'
// confirman en la misma transaccion, asi que un saldo que ya vio el descuento
// va seguido de una llave que ya responde.
//
// Sobre una base quieta los dos ordenes contestan igual, asi que la carrera se
// fuerza y no se espera: un disparador de restriccion diferido congela la venta
// original justo en su commit, y un trazador de consultas la descongela —y
// espera a que confirme— en el hueco entre las dos lecturas del reintento.
func TestVender_ElReintentoNoRechazaLaVentaQueEstaConfirmando(t *testing.T) {
	m := montarVenta(t)
	ctx := context.Background()
	comprarSeisETH(t, m.svc, m.userID)
	crc0, _ := m.billetera(t)
	const llave = "venta-en-vuelo"
	const candado = int64(918273)

	// Una conexion aparte retiene el candado. Es lo que deja congelada a la
	// venta original cuando su disparador diferido corre, en el commit.
	conn, err := m.pool.Acquire(ctx)
	if err != nil {
		t.Fatalf("tomar una conexion: %v", err)
	}
	defer conn.Release()
	if _, err := conn.Exec(ctx, `SELECT pg_advisory_lock($1)`, candado); err != nil {
		t.Fatalf("tomar el candado: %v", err)
	}
	var unaVez sync.Once
	soltar := func() {
		unaVez.Do(func() {
			if _, err := conn.Exec(context.Background(), `SELECT pg_advisory_unlock($1)`, candado); err != nil {
				t.Errorf("soltar el candado: %v", err)
			}
		})
	}
	defer soltar()
	m.congelarAlConfirmar(t, candado)

	pedido := &crypto.SellRequest{Asset: "ETH", Amount: d(6), ToCurrency: "CRC", IdempotencyKey: llave}
	var original *crypto.TransactionRecord
	var errOriginal error
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		original, errOriginal = m.svc.Sell(context.Background(), m.userID, pedido)
	}()

	if !esperar(t, "la venta original llega a su commit", func() bool {
		return m.esperandoElCandado(t, candado)
	}) {
		soltar()
		wg.Wait()
		t.FailNow()
	}

	// El reintento, sobre un servicio igual en todo menos en que su pool avisa
	// cuando termina la primera lectura del pre-chequeo.
	trazador := &trazadorDelPreChequeo{hook: func() {
		soltar()
		esperar(t, "la venta original confirma", func() bool {
			return m.estadoDeLaLlave(t, llave) == transaction.StatusCompleted
		})
	}}
	reintento := servicioDeVenta(t, testutil.PoolTrazado(t, trazador), m.urlPrecios)
	repetida, errRepetida := reintento.Sell(ctx, m.userID, pedido)

	soltar()
	wg.Wait()

	if !trazador.disparado {
		t.Fatal("el trazador nunca vio el pre-chequeo: la prueba no probo la carrera")
	}
	if errOriginal != nil {
		t.Fatalf("la venta original: %v", errOriginal)
	}
	if errRepetida != nil {
		t.Fatalf("el reintento de una venta que SI ocurrio = %v", errRepetida)
	}
	if repetida.ID != original.ID || !repetida.Amount.Equal(original.Amount) {
		t.Fatalf("el reintento devolvio %+v, la venta fue %+v", repetida, original)
	}

	// Y la venta ocurrio una sola vez.
	if got := saldoDeActivo(t, m.svc, m.userID, "ETH"); !got.IsZero() {
		t.Fatalf("saldo ETH = %s, se esperaba 0", got)
	}
	if crc, _ := m.billetera(t); crc != crc0+300_000_000 {
		t.Fatalf("billetera CRC = %d, se esperaba %d", crc, crc0+300_000_000)
	}
	if n := m.ventasAnotadas(t); n != 1 {
		t.Fatalf("ventas anotadas = %d, se esperaba 1", n)
	}
	if n := m.asientosDeLaLlave(t, llave); n != 1 {
		t.Fatalf("asientos de %q = %d, se esperaba 1", llave, n)
	}
}

// congelarAlConfirmar instala un disparador de restriccion DIFERIDO sobre el
// descuento del activo. Un disparador diferido corre en el COMMIT, asi que
// pedir ahi un candado consultivo que otra conexion retiene deja la transaccion
// entera escrita y sin confirmar: justo el instante que hace falta.
func (m *montajeVenta) congelarAlConfirmar(t *testing.T, clave int64) {
	t.Helper()
	ctx := context.Background()
	if _, err := m.pool.Exec(ctx, fmt.Sprintf(`
		CREATE OR REPLACE FUNCTION prueba_congela_en_el_commit() RETURNS trigger
		LANGUAGE plpgsql AS $$
		BEGIN
			PERFORM pg_advisory_xact_lock(%d);
			RETURN NULL;
		END $$`, clave)); err != nil {
		t.Fatalf("crear la funcion que congela: %v", err)
	}
	if _, err := m.pool.Exec(ctx, `
		CREATE CONSTRAINT TRIGGER prueba_congela AFTER UPDATE ON crypto_assets
			DEFERRABLE INITIALLY DEFERRED
			FOR EACH ROW EXECUTE FUNCTION prueba_congela_en_el_commit()`); err != nil {
		t.Fatalf("crear el disparador que congela: %v", err)
	}
	t.Cleanup(func() {
		ctx := context.Background()
		if _, err := m.pool.Exec(ctx, `DROP TRIGGER IF EXISTS prueba_congela ON crypto_assets`); err != nil {
			t.Errorf("quitar el disparador que congela: %v", err)
		}
		if _, err := m.pool.Exec(ctx, `DROP FUNCTION IF EXISTS prueba_congela_en_el_commit()`); err != nil {
			t.Errorf("quitar la funcion que congela: %v", err)
		}
	})
}

// esperandoElCandado dice si alguien quedo bloqueado pidiendo el candado
// consultivo: la senal de que la venta original llego a su commit y ahi se
// quedo. Una clave de 64 bits se reparte en pg_locks entre classid (los 32
// altos) y objid (los 32 bajos).
func (m *montajeVenta) esperandoElCandado(t *testing.T, clave int64) bool {
	t.Helper()
	var esperando bool
	if err := m.pool.QueryRow(context.Background(), `
		SELECT EXISTS (
			SELECT 1 FROM pg_locks
			WHERE locktype = 'advisory' AND NOT granted
			  AND classid = 0 AND objid = $1::bigint::oid)`, clave,
	).Scan(&esperando); err != nil {
		t.Fatalf("mirar los candados: %v", err)
	}
	return esperando
}

// estadoDeLaLlave devuelve el estado de la fila del libro que cuelga de la
// llave, o "" si todavia no hay ninguna. No falla la prueba: se usa dentro de
// esperas, donde "todavia no" es una respuesta valida.
func (m *montajeVenta) estadoDeLaLlave(t *testing.T, llave string) string {
	t.Helper()
	var estado string
	if err := m.pool.QueryRow(context.Background(),
		`SELECT status FROM transactions WHERE user_id = $1::uuid AND idempotency_key = $2`,
		m.userID, llave,
	).Scan(&estado); err != nil {
		return ""
	}
	return estado
}

// esperar bloquea hasta que se cumpla la condicion, con tope. Toda espera de
// estas pruebas es acotada: una que no terminara dejaria colgado el truncado
// del cierre, y con el la suite entera.
func esperar(t *testing.T, que string, cumplido func() bool) bool {
	t.Helper()
	limite := time.Now().Add(15 * time.Second)
	for time.Now().Before(limite) {
		if cumplido() {
			return true
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Errorf("se agoto la espera de: %s", que)
	return false
}

// trazadorDelPreChequeo dispara el gancho UNA vez, apenas termina la primera
// lectura del pre-chequeo de la venta. pgx cierra la consulta —y con ella llama
// a TraceQueryEnd— cuando el resultado ya se leyo, asi que el gancho cae
// exactamente en el hueco entre esa lectura y la siguiente.
type trazadorDelPreChequeo struct {
	hook      func()
	unaVez    sync.Once
	disparado bool
}

// claveDelSQL lleva el texto de la consulta del inicio al final del trazado:
// pgx solo lo entrega en TraceQueryStart, y el contexto que ahi se devuelve es
// el que recibe TraceQueryEnd.
type claveDelSQL struct{}

func (tz *trazadorDelPreChequeo) TraceQueryStart(
	ctx context.Context, _ *pgx.Conn, datos pgx.TraceQueryStartData,
) context.Context {
	return context.WithValue(ctx, claveDelSQL{}, datos.SQL)
}

func (tz *trazadorDelPreChequeo) TraceQueryEnd(ctx context.Context, _ *pgx.Conn, _ pgx.TraceQueryEndData) {
	sql, _ := ctx.Value(claveDelSQL{}).(string)
	// Las dos lecturas del pre-chequeo: la del saldo del activo y la de la
	// llave. Cual de las dos va primero es justo lo que esta prueba mide, asi
	// que el trazador reconoce las dos y se dispara con la que llegue.
	if !strings.Contains(sql, "FROM crypto_assets") && !strings.Contains(sql, "idempotency_key = $2") {
		return
	}
	tz.unaVez.Do(func() {
		tz.disparado = true
		tz.hook()
	})
}
