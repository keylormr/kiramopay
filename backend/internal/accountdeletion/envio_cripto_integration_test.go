package accountdeletion

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/shopspring/decimal"

	"github.com/kiramopay/backend/internal/crypto"
	"github.com/kiramopay/backend/internal/ledger"
	"github.com/kiramopay/backend/internal/qrpayment"
	"github.com/kiramopay/backend/internal/testutil"
	"github.com/kiramopay/backend/internal/transaction"
	"github.com/kiramopay/backend/internal/user"
	"github.com/kiramopay/backend/internal/wallet"
)

// El cripto que se le envia a alguien por su QR mientras esa persona confirma el
// dia 0.
//
// El envio de cripto no pasa por el libro, asi que cerrar las cuentas del libro
// no lo frena. Valida a quien recibe ANTES de su transaccion
// (qrpayment.PersonaDelQR), y entre esa validacion y el abono la persona puede
// confirmar el dia 0. Si el abono entra igual, la cuenta queda por eliminar con
// cripto adentro y el barrido del dia 30 no la cierra (BloqueoCripto) hasta que
// la persona reactive y lo saque. No se pierde nada, pero la persona queda en un
// plazo que no termina. Estas pruebas fuerzan los tres ordenes posibles.

// seEnviaCripto es lo que llega a quien recibe en cada envio de estas pruebas.
// Al precio del stub (1000 USD por unidad) son 10 dolares, muy por debajo del
// tope diario de 190 de una billetera sembrada.
var seEnviaCripto = decimal.RequireFromString("0.01")

// envioDeCripto es el envio de cripto de verdad, con el lector de QR de verdad.
type envioDeCripto struct {
	svc          *crypto.Service
	quienEnvia   string
	qrDeQuienRec string
}

// montarEnvioDeCripto arma el servicio de envio sobre pool, le da un bitcoin a
// quien envia y saca el codigo QR personal de quien recibe.
func montarEnvioDeCripto(t *testing.T, pool *pgxpool.Pool, quienEnvia, quienRecibe string) *envioDeCripto {
	t.Helper()
	ctx := context.Background()
	txSvc := transaction.NewService(transaction.NewRepository(pool), wallet.NewRepository(pool), ledger.NewEngine(pool, nil), nil)
	qrSvc := qrpayment.NewService(qrpayment.NewRepository(pool), txSvc, user.NewRepository(pool), nil)
	precios := crypto.NewPriceService()
	precios.SetBaseURL(stubDePrecios(t))
	svc := crypto.NewService(crypto.NewRepository(pool), precios, txSvc,
		func(context.Context, string, string) (float64, error) { return 500, nil },
		&crypto.Opciones{Destinatarios: qrSvc})

	exec(t, pool, `INSERT INTO crypto_assets (user_id, symbol, name, balance, avg_cost)
		VALUES ($1::uuid, 'BTC', 'Bitcoin', 1, 1000)`, quienEnvia)
	codigo, err := qrSvc.GetOrCreateMyCode(ctx, quienRecibe, "CRC")
	if err != nil {
		t.Fatalf("codigo QR de quien recibe: %v", err)
	}
	return &envioDeCripto{svc: svc, quienEnvia: quienEnvia, qrDeQuienRec: codigo.QRData}
}

func (e *envioDeCripto) enviar(ctx context.Context) error {
	_, err := e.svc.Send(ctx, e.quienEnvia, &crypto.SendRequest{
		Asset: "BTC", Amount: seEnviaCripto, QRData: e.qrDeQuienRec,
	})
	return err
}

// stubDePrecios responde la forma de coins/markets de CoinGecko desde la
// memoria, a 1000 dolares cualquier activo, para no salir a internet.
func stubDePrecios(t *testing.T) string {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body []map[string]any
		for _, id := range strings.Split(r.URL.Query().Get("ids"), ",") {
			if id == "" {
				continue
			}
			body = append(body, map[string]any{
				"id":                          id,
				"current_price":               1000.0,
				"price_change_percentage_24h": 1.5,
				"total_volume":                2_000_000,
				"market_cap":                  3_000_000,
			})
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(body)
	}))
	t.Cleanup(srv.Close)
	return srv.URL
}

// criptoDe es el saldo de BTC de la persona; cero si nunca tuvo.
func criptoDe(t *testing.T, pool *pgxpool.Pool, userID string) decimal.Decimal {
	t.Helper()
	return cuenta1[decimal.Decimal](t, pool,
		`SELECT COALESCE(SUM(balance), 0) FROM crypto_assets WHERE user_id = $1::uuid AND symbol = 'BTC'`, userID)
}

// exigirQueElEnvioNoEntro: el envio rechazado no movio nada. Quien envia
// conserva su bitcoin, quien recibe no tiene cripto y no quedo ningun
// movimiento de cripto escrito.
func exigirQueElEnvioNoEntro(t *testing.T, pool *pgxpool.Pool, quienEnvia, quienRecibe string) {
	t.Helper()
	if got := criptoDe(t, pool, quienRecibe); !got.IsZero() {
		t.Errorf("la cuenta por eliminar recibio %s BTC", got)
	}
	if got := criptoDe(t, pool, quienEnvia); !got.Equal(decimal.NewFromInt(1)) {
		t.Errorf("a quien envia le quedo %s BTC, se esperaba 1", got)
	}
	if n := cuenta1[int](t, pool, `SELECT COUNT(*) FROM crypto_transactions`); n != 0 {
		t.Errorf("el envio rechazado dejo %d movimientos de cripto", n)
	}
}

// El envio confirma despues de que el dia 0 tomo su foto y antes de que bloquee
// la billetera. La foto vieja no ve el cripto; si el dia 0 pasara igual, la
// cuenta quedaria por eliminar con cripto adentro. El dia 0 tiene que enterarse
// y negarse por el cripto, como si hubiera llegado antes.
func TestDiaCero_UnEnvioDeCriptoEnElMedioNoQuedaVarado(t *testing.T) {
	pool := testutil.TestDB(t)
	ctx := context.Background()
	a, b := sembrar(t, pool), sembrar(t, pool)
	e := montarEnvioDeCripto(t, pool, b.ID, a.ID)

	var errEnvio error
	z := &trazadorQueSeMete{
		// La solicitud ya leyo la fila de la persona (la foto esta tomada) y va
		// a bloquear su billetera.
		marca: "FROM wallets WHERE user_id = $1::uuid FOR UPDATE",
		f:     func() { errEnvio = e.enviar(ctx) },
	}
	svc := nuevoServicio(testutil.PoolTrazado(t, z), nil)
	_, errPedido := svc.iniciar(ctx, a.ID, opciones{canal: CanalApp})

	if errEnvio != nil {
		t.Fatalf("el envio del medio fallo: %v", errEnvio)
	}
	if got := codigosDe(errPedido); len(got) != 1 || got[0] != BloqueoCripto {
		t.Fatalf("la solicitud debia ver el cripto y negarse: err=%v codigos=%v", errPedido, got)
	}
	if st := cuenta1[string](t, pool, `SELECT status FROM users WHERE id = $1::uuid`, a.ID); st != "active" {
		t.Errorf("la cuenta quedo en %s", st)
	}
	if got := criptoDe(t, pool, a.ID); !got.Equal(seEnviaCripto) {
		t.Errorf("a quien recibe le llegaron %s BTC, se esperaba %s", got, seEnviaCripto)
	}
}

// La persona confirma el dia 0 despues de que se valido su codigo y antes de que
// el envio abra su transaccion. El envio no puede abonar a una cuenta que ya esta
// por eliminar: contesta lo mismo que si se hubiera escaneado despues (el codigo
// ya no sirve) y no mueve nada.
func TestEnvioDeCripto_ElDiaCeroConfirmadoAntesDelAbonoLoRechaza(t *testing.T) {
	pool := testutil.TestDB(t)
	ctx := context.Background()
	a, b := sembrar(t, pool), sembrar(t, pool)
	svc := nuevoServicio(pool, nil)

	var errPedido error
	z := &trazadorQueSeMete{
		// El codigo ya se valido y el envio abre su transaccion: su primera
		// escritura es la fila del movimiento de quien envia.
		marca: "INSERT INTO crypto_transactions",
		f: func() {
			_, errPedido = svc.iniciar(ctx, a.ID, opciones{canal: CanalApp})
		},
	}
	e := montarEnvioDeCripto(t, testutil.PoolTrazado(t, z), b.ID, a.ID)
	errEnvio := e.enviar(ctx)

	if errPedido != nil {
		t.Fatalf("el dia 0 del medio fallo: %v", errPedido)
	}
	if !errors.Is(errEnvio, qrpayment.ErrQRRevocado) {
		t.Fatalf("el envio a una cuenta que ya estaba por eliminar debia rechazarse con ErrQRRevocado, salio %v", errEnvio)
	}
	exigirQueElEnvioNoEntro(t, pool, b.ID, a.ID)
	if st := cuenta1[string](t, pool, `SELECT status FROM users WHERE id = $1::uuid`, a.ID); st != "pending_deletion" {
		t.Errorf("la cuenta quedo en %s", st)
	}
}

// El envio llega cuando el dia 0 ya bloqueo la billetera de la persona y todavia
// no confirmo. Tiene que esperarlo y, cuando confirma, ver la cuenta por
// eliminar y no abonar. Si mirara el estado antes de esperar, lo veria activo y
// abonaria igual en cuanto el dia 0 soltara la billetera.
func TestEnvioDeCripto_EsperaAlDiaCeroYNoAbonaALaCuentaPorEliminar(t *testing.T) {
	pool := testutil.TestDB(t)
	ctx := context.Background()
	a, b := sembrar(t, pool), sembrar(t, pool)
	e := montarEnvioDeCripto(t, pool, b.ID, a.ID)

	listo := make(chan struct{})
	var errEnvio error
	z := &trazadorQueSeMete{
		// La solicitud ya bloqueo la fila de la persona y su billetera, y empieza
		// a revisar los bloqueos.
		marca: "FROM crypto_assets WHERE user_id = $1::uuid AND balance > 0",
		f: func() {
			go func() {
				defer close(listo)
				errEnvio = e.enviar(ctx)
			}()
			// Se sigue cuando el envio quedo esperando un candado o ya termino.
			// Sin el arreglo no espera nada: abona y confirma.
			esperarHasta(t, "el envio espera al dia 0 o termina", func() bool {
				select {
				case <-listo:
					return true
				default:
				}
				return alguienEsperaUnCandado(t, pool)
			})
		},
	}
	svc := nuevoServicio(testutil.PoolTrazado(t, z), nil)
	_, errPedido := svc.iniciar(ctx, a.ID, opciones{canal: CanalApp})

	select {
	case <-listo:
	case <-time.After(10 * time.Second):
		t.Fatal("el envio nunca termino")
	}
	if errPedido != nil {
		t.Fatalf("el dia 0: %v", errPedido)
	}
	if !errors.Is(errEnvio, qrpayment.ErrQRRevocado) {
		t.Fatalf("el envio que espero al dia 0 debia rechazarse con ErrQRRevocado, salio %v", errEnvio)
	}
	exigirQueElEnvioNoEntro(t, pool, b.ID, a.ID)
	if st := cuenta1[string](t, pool, `SELECT status FROM users WHERE id = $1::uuid`, a.ID); st != "pending_deletion" {
		t.Errorf("la cuenta quedo en %s", st)
	}
}

// esperarHasta sondea condicion hasta que se cumpla o pasen 5 segundos. No se
// cuelga: si no se cumple, marca la prueba en rojo y vuelve para que quien
// llama siga y suelte lo que tenga tomado.
func esperarHasta(t *testing.T, que string, condicion func() bool) {
	t.Helper()
	plazo := time.After(5 * time.Second)
	pulso := time.NewTicker(5 * time.Millisecond)
	defer pulso.Stop()
	for !condicion() {
		select {
		case <-plazo:
			t.Errorf("nunca ocurrio: %s", que)
			return
		case <-pulso.C:
		}
	}
}

// alguienEsperaUnCandado pregunta, desde otra conexion, si alguna consulta de la
// base de pruebas esta esperando un candado de fila.
func alguienEsperaUnCandado(t *testing.T, pool *pgxpool.Pool) bool {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	var espera bool
	if err := pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM pg_stat_activity
			 WHERE datname = current_database()
			   AND wait_event_type = 'Lock'
			   AND pid <> pg_backend_pid()
		)`).Scan(&espera); err != nil {
		t.Errorf("preguntar por los candados: %v", err)
		return false
	}
	return espera
}
