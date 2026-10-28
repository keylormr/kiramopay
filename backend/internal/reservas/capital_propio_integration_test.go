package reservas_test

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"

	"github.com/kiramopay/backend/internal/crypto"
	"github.com/kiramopay/backend/internal/loyalty"
	"github.com/kiramopay/backend/internal/transaction"
)

// El capital propio es la otra mitad del invariante: cuando la reserva se
// mueve para igualar el pasivo, la diferencia tiene que ir a parar a algun
// lado, y ese lado es el capital propio de KiramoPay (SYSTEM:CAPITAL). Estas
// pruebas fijan QUE movimiento mueve el capital y cual no.

func (m *mundo) capital(t *testing.T, moneda string) int64 {
	t.Helper()
	var saldo int64
	if err := m.pool.QueryRow(context.Background(),
		`SELECT balance_minor FROM ledger_account_balances WHERE code = $1`,
		"SYSTEM:CAPITAL:"+moneda).Scan(&saldo); err != nil {
		t.Fatalf("leer el capital propio en %s: %v", moneda, err)
	}
	return saldo
}

func (m *mundo) exigirCapital(t *testing.T, moneda string, esperado int64, que string) {
	t.Helper()
	if got := m.capital(t, moneda); got != esperado {
		t.Errorf("capital propio en %s despues de %s = %d, se esperaba %d", moneda, que, got, esperado)
	}
}

// Las salidas y entradas con el exterior cruzan la frontera del sistema: la
// plata no pasa por el capital de la empresa.
func TestCapital_UnaSalidaOUnaEntradaConElExteriorNoLoToca(t *testing.T) {
	for _, moneda := range monedas {
		t.Run(moneda, func(t *testing.T) {
			m := montar(t)
			ctx := context.Background()
			for _, tipo := range []string{transaction.TypeWithdrawal, transaction.TypeDeposit, transaction.TypeBillPayment} {
				if _, err := m.tx.CreateTransaction(ctx, m.user, &transaction.CreateTransactionRequest{
					Type: tipo, Amount: monto(moneda), Currency: moneda, Internal: true,
					IdempotencyKey: "capital:exterior:" + tipo + ":" + moneda,
				}); err != nil {
					t.Fatalf("%s: %v", tipo, err)
				}
			}
			m.exigirCapital(t, moneda, 0, "mover plata con el exterior")
		})
	}
}

// Lo que KiramoPay cobra deja de ser de los usuarios y pasa al capital propio,
// lo pague quien envia o lo pague quien recibe.
func TestCapital_UnaComisionPasaAlCapital(t *testing.T) {
	for _, moneda := range monedas {
		for _, desdeElReceptor := range []bool{false, true} {
			nombre := moneda + "_la_paga_quien_envia"
			if desdeElReceptor {
				nombre = moneda + "_la_paga_quien_recibe"
			}
			t.Run(nombre, func(t *testing.T) {
				m := montar(t)
				comision := monto(moneda) / 20
				if _, _, err := m.tx.CreateTransfer(context.Background(), &transaction.CreateTransferRequest{
					FromUserID: m.user, ToUserID: m.otro, Amount: monto(moneda), Currency: moneda,
					Fee: comision, FeeFromReceiver: desdeElReceptor,
					IdempotencyKey: "capital:comision:" + nombre,
					TxType:         transaction.TypeQRPayment, ReceiveType: transaction.TypeQRReceive,
				}); err != nil {
					t.Fatalf("transferencia con comision: %v", err)
				}
				m.exigirCapital(t, moneda, comision, "cobrar la comision")
			})
		}
	}
}

// Comprar cripto: la plata pasa a ser de KiramoPay (el capital sube lo que se
// pago). Vender el mismo activo al mismo precio la devuelve: el capital vuelve
// a donde estaba.
func TestCapital_ComprarYVenderCripto(t *testing.T) {
	for _, moneda := range monedas {
		t.Run(moneda, func(t *testing.T) {
			m := montar(t)
			svc := servicioDeCripto(t, m)
			ctx := context.Background()

			pagado := decimal.NewFromInt(50)
			compra, err := svc.Buy(ctx, m.user, &crypto.BuyRequest{
				Asset: "BTC", FromCurrency: moneda, FromAmount: pagado,
				IdempotencyKey: "capital:compra:" + moneda,
			})
			if err != nil {
				t.Fatalf("comprar: %v", err)
			}
			m.exigirCapital(t, moneda, 5_000, "comprar cripto con 50")

			if _, err := svc.Sell(ctx, m.user, &crypto.SellRequest{
				Asset: "BTC", Amount: compra.Amount, ToCurrency: moneda,
				IdempotencyKey: "capital:venta:" + moneda,
			}); err != nil {
				t.Fatalf("vender: %v", err)
			}
			m.exigirCapital(t, moneda, 0, "vender lo comprado al mismo precio")
		})
	}
}

// Fondear promociones es plata de la empresa que entra al capital y NO a la
// reserva; cada canje la pasa del capital a la reserva, por lo que se regala.
func TestCapital_FondearYCanjearPromociones(t *testing.T) {
	m := montar(t)
	ctx := context.Background()
	svc := loyalty.NewService(loyalty.NewRepository(m.pool), &loyalty.Options{Ledger: m.eng})
	svc.UsarHistorial(m.tx)

	antes, err := reservaDe(ctx, m, "CRC")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.FondearPromociones(ctx, m.otro, 1_000_000, "TRF-CAPITAL", uuid.NewString()); err != nil {
		t.Fatalf("fondear: %v", err)
	}
	m.exigirCapital(t, "CRC", 1_000_000, "fondear promociones")
	if despues, _ := reservaDe(ctx, m, "CRC"); despues != antes {
		t.Fatalf("la reserva paso de %d a %d al fondear: fondear no es plata de los usuarios", antes, despues)
	}

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
	m.exigirCapital(t, "CRC", 950_000, "canjear un premio de 50.000")
	if despues, _ := reservaDe(ctx, m, "CRC"); despues != antes+50_000 {
		t.Fatalf("la reserva = %d, se esperaba %d: lo regalado tiene que llegar a la reserva", despues, antes+50_000)
	}
	m.iguales(t, "fondear y canjear")
}

func reservaDe(ctx context.Context, m *mundo, moneda string) (int64, error) {
	var saldo int64
	err := m.pool.QueryRow(ctx,
		`SELECT balance_minor FROM ledger_account_balances WHERE code = $1`,
		"SYSTEM:RESERVE:"+moneda).Scan(&saldo)
	return saldo, err
}
