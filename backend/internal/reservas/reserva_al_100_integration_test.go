package reservas_test

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/shopspring/decimal"

	"github.com/kiramopay/backend/internal/crypto"
	"github.com/kiramopay/backend/internal/ledger"
	"github.com/kiramopay/backend/internal/loyalty"
	"github.com/kiramopay/backend/internal/marketplace"
	"github.com/kiramopay/backend/internal/payout"
	"github.com/kiramopay/backend/internal/qrpayment"
	"github.com/kiramopay/backend/internal/savings"
	"github.com/kiramopay/backend/internal/testutil"
	"github.com/kiramopay/backend/internal/transaction"
	"github.com/kiramopay/backend/internal/user"
	"github.com/kiramopay/backend/internal/wallet"
)

// Invariante "siempre al 100 %" (decision del dueno, 28-10): en cada moneda la
// reserva es EXACTAMENTE igual a lo que se les debe a los usuarios, despues de
// CUALQUIER operacion. El dinero propio de KiramoPay vive aparte.
//
// Antes, una salida al exterior bajaba el pasivo y dejaba la reserva intacta
// (sobraba plata en la cifra publicada), y una venta de cripto, un cashback o
// una comision subian o bajaban el pasivo sin que la reserva se enterara (faltaba
// o sobraba). La cifra publicada se separaba de la realidad con cada operacion.
//
// Cada prueba arranca de una base nueva donde reserva y pasivo coinciden (la
// siembra de usuarios las deja iguales), ejecuta UNA clase de operacion y exige
// la igualdad exacta despues, en colones y en dolares.

const (
	pasivoInicial = "estado inicial"
	montoColones  = int64(10_000) // 100,00 colones
	montoDolares  = int64(1_000)  // 10,00 dolares
)

var monedas = []string{"CRC", "USD"}

func monto(moneda string) int64 {
	if moneda == "USD" {
		return montoDolares
	}
	return montoColones
}

type mundo struct {
	pool *pgxpool.Pool
	eng  *ledger.Engine
	tx   *transaction.Service
	// user es quien opera; otro es la contraparte (y el revisor/administrador).
	user, otro string
}

// montar arma una base nueva con dos personas y dolares en el libro. La siembra
// de usuarios solo deja colones en el libro: los dolares se abonan aqui por el
// libro (debito reserva / credito billetera) para que la reserva y el pasivo en
// dolares tambien arranquen iguales y con algo que mover.
func montar(t *testing.T) *mundo {
	t.Helper()
	pool := testutil.TestDB(t)
	eng := ledger.NewEngine(pool, slog.New(slog.NewJSONHandler(os.Stdout, nil)))
	tx := transaction.NewService(transaction.NewRepository(pool), wallet.NewRepository(pool), eng, nil)
	m := &mundo{
		pool: pool, eng: eng, tx: tx,
		user: testutil.SeedTestUser(t, pool, "702650930", "dummy"),
		otro: testutil.SeedTestUser2(t, pool),
	}
	m.abonar(t, m.user, "USD", 100_000)
	m.abonar(t, m.otro, "USD", 100_000)
	m.iguales(t, pasivoInicial)
	return m
}

// abonar le da saldo a una persona POR EL LIBRO: debito reserva, credito
// billetera. Sube reserva y pasivo lo mismo.
func (m *mundo) abonar(t *testing.T, userID, moneda string, minor int64) {
	t.Helper()
	reserva := ledger.SystemReserveCRC
	if moneda == "USD" {
		reserva = ledger.SystemReserveUSD
	}
	if _, err := m.eng.Post(context.Background(), &ledger.Posting{
		Description: "TEST_ABONO_" + moneda,
		CreatedBy:   userID,
		Entries: []ledger.Entry{
			{Account: ledger.Account{SystemCode: reserva}, Side: ledger.Debit, AmountMinor: minor, Currency: moneda},
			{Account: ledger.Account{UserID: userID}, Side: ledger.Credit, AmountMinor: minor, Currency: moneda},
		},
	}); err != nil {
		t.Fatalf("abonar %d %s: %v", minor, moneda, err)
	}
}

func (m *mundo) iguales(t *testing.T, tras string) {
	t.Helper()
	testutil.ExigirReservaIgualAlPasivo(t, m.pool, tras)
}

// ── Salidas y entradas con el exterior ──────────────────────────────────────

// Retirar a otro banco, depositar desde otro banco, pagar un recibo y recargar
// saldo cruzan la frontera del sistema: el pasivo baja (o sube) y la reserva
// tiene que bajar (o subir) lo mismo. El deposito estaba al reves: subia el
// pasivo y dejaba la reserva como estaba.
func TestReserva_OperacionesConElExterior(t *testing.T) {
	tipos := []string{
		transaction.TypeWithdrawal, transaction.TypeDeposit,
		transaction.TypeBillPayment, transaction.TypeRecharge,
	}
	for _, moneda := range monedas {
		for _, tipo := range tipos {
			t.Run(tipo+"_"+moneda, func(t *testing.T) {
				m := montar(t)
				if _, err := m.tx.CreateTransaction(context.Background(), m.user, &transaction.CreateTransactionRequest{
					Type: tipo, Amount: monto(moneda), Currency: moneda, Internal: true,
					CounterpartyType: "external", CounterpartyName: "Banco",
					IdempotencyKey: "reservas:" + tipo + ":" + moneda,
				}); err != nil {
					t.Fatalf("%s en %s: %v", tipo, moneda, err)
				}
				m.iguales(t, tipo+" en "+moneda)
			})
		}
	}
}

// Un envio a otro banco por un riel de payouts: al enviarlo la plata sale del
// sistema, y si el riel lo rechaza vuelve entera.
func TestReserva_PayoutsAlExterior(t *testing.T) {
	casos := []struct {
		nombre, cuenta string
	}{
		{"completado", "00012345"},
		{"rechazado_y_reembolsado", "fail-999"},
	}
	for _, moneda := range monedas {
		for _, c := range casos {
			t.Run(c.nombre+"_"+moneda, func(t *testing.T) {
				m := montar(t)
				registro := payout.NewRegistry()
				if err := registro.Register(payout.NewMockRail()); err != nil {
					t.Fatalf("registrar el riel: %v", err)
				}
				svc := payout.NewService(payout.NewRepository(m.pool), m.eng, registro,
					&payout.Options{History: m.tx, Logger: slog.New(slog.NewTextHandler(os.Stdout, nil))})
				p, err := svc.Create(context.Background(), m.user, &payout.CreateRequest{
					Rail: "mock", AmountMinor: monto(moneda), Currency: moneda,
					Destination:    payout.Destination{Type: "bank_account", Account: c.cuenta, Name: "Beneficiario"},
					IdempotencyKey: "reservas:payout:" + c.nombre + ":" + moneda,
				})
				if err != nil {
					t.Fatalf("payout %s en %s: %v", c.nombre, moneda, err)
				}
				m.iguales(t, "payout "+c.nombre+" ("+string(p.Status)+") en "+moneda)
			})
		}
	}
}

// Una compra del marketplace (comida o viaje) es plata que sale hacia el socio.
func TestReserva_CompraEnElMarketplace(t *testing.T) {
	m := montar(t)
	svc := marketplace.NewService(marketplace.NewRepository(m.pool), m.eng, m.tx,
		&marketplace.Options{CobrosActivos: true})
	if _, err := svc.CreateFoodOrder(context.Background(), m.user, &marketplace.CreateFoodOrderRequest{
		PartnerCode: "ubereats", RestaurantName: "Soda Tica",
		Items: []marketplace.FoodOrderItemReq{{Name: "Casado", Quantity: 1, Price: 350_000}},
	}); err != nil {
		t.Fatalf("CreateFoodOrder: %v", err)
	}
	m.iguales(t, "pedido del marketplace")
}

// ── Cripto ──────────────────────────────────────────────────────────────────

// precios cotiza cualquier activo a 1000 dolares; el tipo de cambio es 500.
func precios(t *testing.T) string {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var cuerpo []map[string]any
		for _, id := range strings.Split(r.URL.Query().Get("ids"), ",") {
			if id == "" {
				continue
			}
			cuerpo = append(cuerpo, map[string]any{
				"id": id, "current_price": 1000,
				"price_change_percentage_24h": 1.5, "total_volume": 2_000_000, "market_cap": 3_000_000,
			})
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(cuerpo)
	}))
	t.Cleanup(srv.Close)
	return srv.URL
}

func servicioDeCripto(t *testing.T, m *mundo) *crypto.Service {
	t.Helper()
	feed := crypto.NewPriceService()
	feed.SetBaseURL(precios(t))
	return crypto.NewService(crypto.NewRepository(m.pool), feed, m.tx,
		func(context.Context, string, string) (float64, error) { return 500, nil }, nil)
}

// Comprar cripto saca fiat del pasivo y vender lo devuelve. Esa plata no sale
// del sistema: pasa a ser de KiramoPay, que la pone o la retira de la reserva.
func TestReserva_CompraYVentaDeCripto(t *testing.T) {
	for _, moneda := range monedas {
		t.Run(moneda, func(t *testing.T) {
			m := montar(t)
			svc := servicioDeCripto(t, m)
			ctx := context.Background()

			pagado := decimal.NewFromInt(50) // 50 colones o 50 dolares
			compra, err := svc.Buy(ctx, m.user, &crypto.BuyRequest{
				Asset: "BTC", FromCurrency: moneda, FromAmount: pagado,
				IdempotencyKey: "reservas:compra:" + moneda,
			})
			if err != nil {
				t.Fatalf("comprar BTC con %s: %v", moneda, err)
			}
			m.iguales(t, "comprar cripto con "+moneda)

			if _, err := svc.Sell(ctx, m.user, &crypto.SellRequest{
				Asset: "BTC", Amount: compra.Amount, ToCurrency: moneda,
				IdempotencyKey: "reservas:venta:" + moneda,
			}); err != nil {
				t.Fatalf("vender BTC por %s: %v", moneda, err)
			}
			m.iguales(t, "vender cripto por "+moneda)
		})
	}
}

// Convertir un activo en otro no toca el fiat: la igualdad tiene que seguir.
func TestReserva_ConversionDeCripto(t *testing.T) {
	m := montar(t)
	svc := servicioDeCripto(t, m)
	ctx := context.Background()

	compra, err := svc.Buy(ctx, m.user, &crypto.BuyRequest{
		Asset: "BTC", FromCurrency: "CRC", FromAmount: decimal.NewFromInt(50),
		IdempotencyKey: "reservas:compra-para-convertir",
	})
	if err != nil {
		t.Fatalf("comprar: %v", err)
	}
	if _, err := svc.Convert(ctx, m.user, &crypto.ConvertRequest{
		FromAsset: "BTC", ToAsset: "ETH", FromAmount: compra.Amount.Div(decimal.NewFromInt(2)),
		IdempotencyKey: "reservas:convertir",
	}); err != nil {
		t.Fatalf("convertir: %v", err)
	}
	m.iguales(t, "convertir cripto")
}

// ── Comisiones ──────────────────────────────────────────────────────────────

// Lo que KiramoPay cobra sale del pasivo (de quien paga) y la reserva tiene que
// bajar lo mismo, porque esa plata ya no es de los usuarios.
func TestReserva_TransferenciasConComision(t *testing.T) {
	modelos := []struct {
		nombre          string
		desdeElReceptor bool
	}{
		{"la_paga_quien_envia", false},
		{"la_paga_quien_recibe", true},
	}
	for _, moneda := range monedas {
		for _, modelo := range modelos {
			t.Run(modelo.nombre+"_"+moneda, func(t *testing.T) {
				m := montar(t)
				comision := monto(moneda) / 20 // 5 %
				if _, _, err := m.tx.CreateTransfer(context.Background(), &transaction.CreateTransferRequest{
					FromUserID: m.user, ToUserID: m.otro, Amount: monto(moneda), Currency: moneda,
					Fee: comision, FeeFromReceiver: modelo.desdeElReceptor,
					IdempotencyKey: "reservas:comision:" + modelo.nombre + ":" + moneda,
					TxType:         transaction.TypeQRPayment, ReceiveType: transaction.TypeQRReceive,
				}); err != nil {
					t.Fatalf("transferencia con comision: %v", err)
				}
				m.iguales(t, "transferencia con comision ("+modelo.nombre+") en "+moneda)
			})
		}
	}
}

// Una transferencia sin comision entre dos personas no cambia la suma: el caso
// base que no se debe romper.
func TestReserva_TransferenciaEntrePersonas(t *testing.T) {
	for _, moneda := range monedas {
		t.Run(moneda, func(t *testing.T) {
			m := montar(t)
			if _, _, err := m.tx.CreateTransfer(context.Background(), &transaction.CreateTransferRequest{
				FromUserID: m.user, ToUserID: m.otro, Amount: monto(moneda), Currency: moneda,
				IdempotencyKey: "reservas:p2p:" + moneda,
				TxType:         transaction.TypeP2PSend, ReceiveType: transaction.TypeP2PReceive,
			}); err != nil {
				t.Fatalf("transferencia: %v", err)
			}
			m.iguales(t, "transferencia entre personas en "+moneda)
		})
	}
}

// El cobro de un comercio por QR lleva comision (se descuenta al comercio), y el
// comercio puede pasar su saldo a su billetera personal: el saldo del comercio
// es pasivo igual que el de una persona.
func TestReserva_CobroPorQRYRetiroDelComercio(t *testing.T) {
	m := montar(t)
	ctx := context.Background()
	svc := qrpayment.NewService(qrpayment.NewRepository(m.pool), m.tx, user.NewRepository(m.pool), nil)

	comercio, err := svc.RegisterMerchant(ctx, m.otro, &qrpayment.RegisterMerchantRequest{
		Name: "Soda Tica", Category: "restaurant", Cedula: "3-101-123", CedulaType: "juridica", LegalName: "Soda Tica SA",
	})
	if err != nil {
		t.Fatalf("registrar comercio: %v", err)
	}
	// El revisor es la otra persona sembrada: no puede ser la duena.
	if _, err := svc.ApproveMerchant(ctx, comercio.ID, m.user, qrpayment.ActorContext{}); err != nil {
		t.Fatalf("aprobar comercio: %v", err)
	}
	qr, err := svc.CreateQRCode(ctx, m.otro, &qrpayment.CreateQRCodeRequest{
		Type: "merchant_fixed", Amount: 100_000, Currency: "CRC", MerchantID: comercio.ID,
	})
	if err != nil {
		t.Fatalf("crear QR: %v", err)
	}
	pago, err := svc.ScanAndPay(ctx, m.user, &qrpayment.ScanQRPaymentRequest{QRData: qr.QRData, Currency: "CRC"})
	if err != nil {
		t.Fatalf("pagar el QR: %v", err)
	}
	if pago.Fee <= 0 {
		t.Fatalf("el cobro no llevo comision (%d): la prueba no ejercita el caso", pago.Fee)
	}
	m.iguales(t, "cobro por QR con comision")

	saldo, err := svc.MerchantBalance(ctx, comercio.ID, m.otro, "CRC")
	if err != nil {
		t.Fatalf("saldo del comercio: %v", err)
	}
	if _, _, err := m.tx.WithdrawMerchantToUser(ctx, comercio.ID, "Soda Tica", m.otro, "CRC", saldo, "reservas:retiro-comercio"); err != nil {
		t.Fatalf("retiro del comercio: %v", err)
	}
	m.iguales(t, "retiro del saldo del comercio a su billetera")
}

// ── Plata que se regala ─────────────────────────────────────────────────────

// Fondear promociones y canjear un premio en efectivo. Lo que la empresa pone
// para regalar es plata suya, no de los usuarios, asi que no es reserva hasta
// que se regala; y lo que se regala pasa de la empresa a la reserva, porque
// sube lo que se les debe a los usuarios.
func TestReserva_FondeoYCanjeDeCashback(t *testing.T) {
	m := montar(t)
	ctx := context.Background()
	svc := loyalty.NewService(loyalty.NewRepository(m.pool), &loyalty.Options{Ledger: m.eng})
	svc.UsarHistorial(m.tx)

	if _, err := svc.FondearPromociones(ctx, m.otro, 1_000_000, "TRF-PRUEBA", uuid.NewString()); err != nil {
		t.Fatalf("fondear: %v", err)
	}
	m.iguales(t, "fondear promociones")

	if _, err := m.pool.Exec(ctx, `
		INSERT INTO loyalty_accounts (user_id, total_points, available_points, lifetime_points)
		VALUES ($1::uuid, 1000, 1000, 1000)
		ON CONFLICT (user_id) DO UPDATE SET available_points = EXCLUDED.available_points`, m.user); err != nil {
		t.Fatalf("dar puntos: %v", err)
	}
	var premio string
	if err := m.pool.QueryRow(ctx, `
		INSERT INTO loyalty_rewards (name, category, points_cost, stock, active, cashback_minor)
		VALUES ('Cashback 500', 'discount', 500, -1, TRUE, 50000) RETURNING id::text`).Scan(&premio); err != nil {
		t.Fatalf("crear premio: %v", err)
	}
	if _, err := svc.RedeemReward(ctx, m.user, &loyalty.RedeemRewardRequest{RewardID: premio}); err != nil {
		t.Fatalf("canjear: %v", err)
	}
	m.iguales(t, "canjear cashback")
}

// ── Plata que cambia de bolsillo dentro del sistema ─────────────────────────

// Apartar plata en una meta de ahorro y sacarla: la meta cuenta como pasivo
// (sigue siendo del usuario), asi que la suma no cambia.
func TestReserva_MetasDeAhorro(t *testing.T) {
	m := montar(t)
	ctx := context.Background()
	svc := savings.NewService(savings.NewRepository(m.pool), m.eng, m.tx)

	meta, err := svc.Create(ctx, m.user, &savings.CreateGoalRequest{
		Name: "Casa", TargetMinor: 100_000_000, Currency: "CRC", Icon: "home",
	})
	if err != nil {
		t.Fatalf("crear meta: %v", err)
	}
	if _, _, err := svc.Deposit(ctx, m.user, meta.ID, 50_000, ""); err != nil {
		t.Fatalf("depositar: %v", err)
	}
	m.iguales(t, "apartar en una meta de ahorro")
	if _, _, err := svc.Withdraw(ctx, m.user, meta.ID, 20_000, ""); err != nil {
		t.Fatalf("retirar de la meta: %v", err)
	}
	m.iguales(t, "sacar de una meta de ahorro")
}
