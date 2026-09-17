package crypto_test

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/kiramopay/backend/internal/crypto"
	"github.com/kiramopay/backend/internal/ledger"
	"github.com/kiramopay/backend/internal/qrpayment"
	"github.com/kiramopay/backend/internal/testutil"
	"github.com/kiramopay/backend/internal/transaction"
	"github.com/kiramopay/backend/internal/user"
	"github.com/kiramopay/backend/internal/wallet"
	"github.com/kiramopay/backend/pkg/hash"
	"github.com/shopspring/decimal"
)

// Enviar cripto a otra persona de KiramoPay.
//
// Lo que estas pruebas vigilan, antes que nada: que lo que la hoja de
// confirmacion promete sea exactamente lo que ocurre. La pantalla vieja decia
// "enviado" y no enviaba nada — descontaba el saldo en la memoria del telefono
// e inventaba un txHash. Aqui se comprueba contra la base: cuanto baja de quien
// envia, cuanto llega a quien recibe, que la comision quede anotada y que el
// movimiento cuente para el tope y lo vea la UIF.

// Los numeros de todas las pruebas, con el precio del stub (1000 USD por BTC).
// Se envia poco a proposito: el tope diario en dolares del monedero de prueba
// son 190 dolares, y hay pruebas que envian dos veces.
var (
	seEnvia      = d(0.08)   // lo que llega limpio a quien recibe
	laComision   = d(0.0002) // 0,25 % de 0,08
	bajaDelSaldo = d(0.0802) // seEnvia + laComision
)

// avisosDePrueba guarda el aviso que se le manda a quien recibe.
type avisosDePrueba struct {
	paraQuien string
	cuerpo    string
	veces     int
}

func (a *avisosDePrueba) NotifyUser(_ context.Context, userID, _, body, _ string) error {
	a.paraQuien, a.cuerpo = userID, body
	a.veces++
	return nil
}

// mfaDePrueba deja decidir a cada prueba si el monto pide segundo factor y si
// la persona ya lo paso.
type mfaDePrueba struct {
	exige      bool
	verificado bool
	proposito  string
}

func (m *mfaDePrueba) IsMFARequired(int64, string) bool { return m.exige }

func (m *mfaDePrueba) HasVerifiedMFA(_ context.Context, _, purpose string) (bool, error) {
	m.proposito = purpose
	return m.verificado, nil
}

// uifDePrueba anota lo que se le reporto al monitoreo.
type uifDePrueba struct {
	veces       int
	moneda      string
	montoMinor  int64
	deQuien     string
	movimientos []string
}

func (u *uifDePrueba) Report(_ context.Context, userID, txID, currency string, amountMinor int64) {
	u.veces++
	u.deQuien, u.moneda, u.montoMinor = userID, currency, amountMinor
	u.movimientos = append(u.movimientos, txID)
}

type entornoDeEnvio struct {
	svc         *crypto.Service
	pool        *pgxpool.Pool
	qr          *qrpayment.Service
	quienEnvia  string
	quienRecibe string
	// qrDelReceptor es el codigo permanente de quien recibe, tal como sale del
	// escaner: el envio no tiene campo de direccion porque no hay cadena a la
	// que mandar nada.
	qrDelReceptor string
	avisos        *avisosDePrueba
	mfa           *mfaDePrueba
	uif           *uifDePrueba
}

// montarEnvio arma el servicio con TODOS los colaboradores del envio, incluido
// el qrpayment de verdad: los codigos QR tienen un solo lector en la
// aplicacion, y que el envio use ESE y no otro es justo lo que hay que probar.
func montarEnvio(t *testing.T) *entornoDeEnvio {
	t.Helper()
	return montarEnvioCon(t, startPriceStub(t).URL)
}

func montarEnvioCon(t *testing.T, urlPrecios string) *entornoDeEnvio {
	t.Helper()
	pool := testutil.TestDB(t)
	ctx := context.Background()

	repo := crypto.NewRepository(pool)
	precios := crypto.NewPriceService()
	precios.SetBaseURL(urlPrecios)
	l := ledger.NewEngine(pool, slog.New(slog.NewJSONHandler(os.Stdout, nil)))
	txSvc := transaction.NewService(transaction.NewRepository(pool), wallet.NewRepository(pool), l, nil)
	qrSvc := qrpayment.NewService(qrpayment.NewRepository(pool), txSvc, user.NewRepository(pool), nil)

	e := &entornoDeEnvio{
		pool:   pool,
		qr:     qrSvc,
		avisos: &avisosDePrueba{},
		mfa:    &mfaDePrueba{},
		uif:    &uifDePrueba{},
	}
	e.svc = crypto.NewService(repo, precios, txSvc,
		func(context.Context, string, string) (float64, error) { return 500, nil },
		&crypto.Opciones{
			Destinatarios: qrSvc,
			MFA:           e.mfa,
			UIF:           e.uif,
			Avisos:        e.avisos,
		})

	pinHash, _ := hash.HashPin("1234")
	e.quienEnvia = testutil.SeedTestUser(t, pool, "702650930", pinHash)
	e.quienRecibe = testutil.SeedTestUser2(t, pool)

	// Un bitcoin entero para quien envia. Entra por el mismo camino que una
	// compra, asi el promedio de costo queda puesto y el saldo es real.
	if err := repo.UpsertAsset(ctx, e.quienEnvia, "BTC", "Bitcoin", d(1), d(1000)); err != nil {
		t.Fatalf("sembrar BTC: %v", err)
	}
	e.qrDelReceptor = e.miCodigo(t, e.quienRecibe)

	return e
}

func (e *entornoDeEnvio) miCodigo(t *testing.T, userID string) string {
	t.Helper()
	codigo, err := e.qr.GetOrCreateMyCode(context.Background(), userID, "CRC")
	if err != nil {
		t.Fatalf("codigo QR de %s: %v", userID, err)
	}
	return codigo.QRData
}

func (e *entornoDeEnvio) enviar(cantidad decimal.Decimal, llave string) (*crypto.TransactionRecord, error) {
	return e.svc.Send(context.Background(), e.quienEnvia, &crypto.SendRequest{
		Asset: "BTC", Amount: cantidad, QRData: e.qrDelReceptor, IdempotencyKey: llave,
	})
}

// saldoDe lee el saldo de BTC directo de la base. Cero si no hay fila: es lo
// que le pasa a quien nunca ha tenido ese activo.
func (e *entornoDeEnvio) saldoDe(userID string) decimal.Decimal {
	var saldo decimal.Decimal
	err := e.pool.QueryRow(context.Background(),
		`SELECT balance FROM crypto_assets WHERE user_id = $1::uuid AND symbol = 'BTC'`,
		userID).Scan(&saldo)
	if err != nil {
		return decimal.Zero
	}
	return saldo
}

func (e *entornoDeEnvio) exigirSaldos(t *testing.T, envia, recibe decimal.Decimal) {
	t.Helper()
	if s := e.saldoDe(e.quienEnvia); !s.Equal(envia) {
		t.Fatalf("saldo de quien envia = %s, esperaba %s", s, envia)
	}
	if s := e.saldoDe(e.quienRecibe); !s.Equal(recibe) {
		t.Fatalf("saldo de quien recibe = %s, esperaba %s", s, recibe)
	}
}

// exigirQueNadaSeMovio es la asercion que de verdad importa en todo rechazo: un
// envio que no se hizo no puede haber dejado saldo movido, ni comision cobrada,
// ni fila de historial comiendole tope a la persona, ni un aviso diciendole a
// alguien que le llego algo.
func (e *entornoDeEnvio) exigirQueNadaSeMovio(t *testing.T) {
	t.Helper()
	ctx := context.Background()
	e.exigirSaldos(t, d(1), decimal.Zero)

	var movimientos, comisiones, historial int
	if err := e.pool.QueryRow(ctx, `SELECT COUNT(*) FROM crypto_transactions`).Scan(&movimientos); err != nil {
		t.Fatalf("contar movimientos: %v", err)
	}
	if err := e.pool.QueryRow(ctx, `SELECT COUNT(*) FROM crypto_platform_fees`).Scan(&comisiones); err != nil {
		t.Fatalf("contar comisiones: %v", err)
	}
	if err := e.pool.QueryRow(ctx, `SELECT COUNT(*) FROM transactions`).Scan(&historial); err != nil {
		t.Fatalf("contar historial: %v", err)
	}
	if movimientos != 0 || comisiones != 0 || historial != 0 {
		t.Fatalf("un envio rechazado dejo %d movimientos, %d comisiones y %d filas de historial",
			movimientos, comisiones, historial)
	}
	if e.avisos.veces != 0 {
		t.Fatalf("se aviso de un envio que no ocurrio")
	}
}

// ── El envio que sale bien ──────────────────────────────────────────────────

// La propiedad central: del saldo de quien envia baja la cantidad MAS la
// comision, y a quien recibe le llega la cantidad limpia — exactamente los tres
// numeros que la hoja de confirmacion mostro.
func TestEnviarCripto_BajaLaCantidadMasLaComisionYLlegaLaCantidad(t *testing.T) {
	e := montarEnvio(t)
	ctx := context.Background()

	vista, err := e.svc.PreviewSend(ctx, e.quienEnvia, &crypto.SendRequest{
		Asset: "btc", Amount: seEnvia, QRData: e.qrDelReceptor,
	})
	if err != nil {
		t.Fatalf("PreviewSend: %v", err)
	}
	if vista.RecipientName != "Admin User" {
		t.Fatalf("la hoja nombra a %q, esperaba a quien es dueno del QR", vista.RecipientName)
	}
	if vista.Asset != "BTC" {
		t.Fatalf("activo = %q, esperaba BTC", vista.Asset)
	}
	if !vista.Amount.Equal(seEnvia) || !vista.Fee.Equal(laComision) || !vista.Total.Equal(bajaDelSaldo) {
		t.Fatalf("vista previa: llega %s, comision %s, baja %s; esperaba %s / %s / %s",
			vista.Amount, vista.Fee, vista.Total, seEnvia, laComision, bajaDelSaldo)
	}
	// El porcentaje lo manda el servidor, que es el que cobra: si la pantalla lo
	// llevara escrito a mano, el dia que cambie diria uno y se cobraria otro.
	if !vista.FeePercent.Equal(d(0.25)) {
		t.Fatalf("porcentaje mostrado = %s, esperaba 0.25", vista.FeePercent)
	}

	envio, err := e.enviar(seEnvia, "")
	if err != nil {
		t.Fatalf("Send: %v", err)
	}

	// Lo que la vista previa prometio es lo que el envio cobro.
	if !envio.Fee.Equal(vista.Fee) || !envio.Total.Equal(vista.Total) {
		t.Fatalf("el envio cobro comision %s y total %s; la hoja habia dicho %s y %s",
			envio.Fee, envio.Total, vista.Fee, vista.Total)
	}
	if envio.CounterpartyUserID != e.quienRecibe || envio.CounterpartyName != "Admin User" {
		t.Fatalf("contraparte = %q (%s), esperaba a quien recibe",
			envio.CounterpartyName, envio.CounterpartyUserID)
	}

	e.exigirSaldos(t, d(1).Sub(bajaDelSaldo), seEnvia)

	// La comision queda anotada aparte, en el MISMO activo: las cuentas de
	// comisiones del libro son de fiat y no pueden guardar BTC.
	var activoCobrado string
	var montoCobrado decimal.Decimal
	if err := e.pool.QueryRow(ctx,
		`SELECT asset, amount FROM crypto_platform_fees WHERE crypto_tx_id = $1::uuid`,
		envio.ID).Scan(&activoCobrado, &montoCobrado); err != nil {
		t.Fatalf("leer la comision cobrada: %v", err)
	}
	if activoCobrado != "BTC" || !montoCobrado.Equal(laComision) {
		t.Fatalf("comision anotada: %s %s, esperaba %s BTC", montoCobrado, activoCobrado, laComision)
	}

	// Cuadratura por activo: el BTC que la plataforma tiene es la suma de los
	// saldos mas lo cobrado. Si un envio evaporara o creara cripto, falla aqui.
	var enSaldos, enComisiones decimal.Decimal
	if err := e.pool.QueryRow(ctx,
		`SELECT COALESCE(SUM(balance), 0) FROM crypto_assets WHERE symbol = 'BTC'`).Scan(&enSaldos); err != nil {
		t.Fatalf("sumar saldos: %v", err)
	}
	if err := e.pool.QueryRow(ctx,
		`SELECT COALESCE(SUM(amount), 0) FROM crypto_platform_fees WHERE asset = 'BTC'`).Scan(&enComisiones); err != nil {
		t.Fatalf("sumar comisiones: %v", err)
	}
	if !enSaldos.Add(enComisiones).Equal(d(1)) {
		t.Fatalf("el BTC de la plataforma quedo en %s, y antes del envio era 1", enSaldos.Add(enComisiones))
	}
}

// Quien recibe tiene que ver de quien le llego, y con el promedio de costo
// puesto al precio del dia: sin eso, su pantalla diria que le costo cero y toda
// su ganancia seria falsa.
func TestEnviarCripto_LaPataDeQuienRecibe(t *testing.T) {
	e := montarEnvio(t)
	ctx := context.Background()

	if _, err := e.enviar(seEnvia, ""); err != nil {
		t.Fatalf("Send: %v", err)
	}

	movs, err := e.svc.GetTransactions(ctx, e.quienRecibe)
	if err != nil {
		t.Fatalf("GetTransactions: %v", err)
	}
	if len(movs) != 1 {
		t.Fatalf("quien recibe tiene %d movimientos, esperaba 1", len(movs))
	}
	recibo := movs[0]
	if recibo.Type != "receive" {
		t.Fatalf("tipo = %s, esperaba receive", recibo.Type)
	}
	if !recibo.Amount.Equal(seEnvia) || !recibo.Fee.IsZero() {
		t.Fatalf("recibio %s con comision %s; la comision la paga quien envia",
			recibo.Amount, recibo.Fee)
	}
	if recibo.CounterpartyUserID != e.quienEnvia || recibo.CounterpartyName != "Test User" {
		t.Fatalf("la pata de quien recibe dice que vino de %q (%s), esperaba a quien envio",
			recibo.CounterpartyName, recibo.CounterpartyUserID)
	}

	var costo decimal.Decimal
	if err := e.pool.QueryRow(ctx,
		`SELECT avg_cost FROM crypto_assets WHERE user_id = $1::uuid AND symbol = 'BTC'`,
		e.quienRecibe).Scan(&costo); err != nil {
		t.Fatalf("leer el costo promedio: %v", err)
	}
	if !costo.Equal(d(1000)) {
		t.Fatalf("costo promedio de quien recibe = %s, esperaba el precio del dia (1000)", costo)
	}
}

// El envio no mueve un centimo de fiat, pero tiene que quedar en `transactions`
// igual: el tope de gasto y el monitoreo de la UIF se calculan sobre esa tabla.
// Sin esa fila, enviar cripto seria el camino abierto para sacar valor sin que
// nada lo cuente ni lo mire.
func TestEnviarCripto_QuedaEnElHistorialYLoVeLaUIF(t *testing.T) {
	e := montarEnvio(t)
	ctx := context.Background()

	envio, err := e.enviar(seEnvia, "")
	if err != nil {
		t.Fatalf("Send: %v", err)
	}

	var tipo, moneda string
	var monto, comisionMinor int64
	if err := e.pool.QueryRow(ctx,
		`SELECT type, currency, amount, fee FROM transactions WHERE user_id = $1::uuid`,
		e.quienEnvia).Scan(&tipo, &moneda, &monto, &comisionMinor); err != nil {
		t.Fatalf("leer el historial: %v", err)
	}
	// 0,08 BTC a 1000 USD son 80 dolares; la comision, 0,20 de dolar. El tope se
	// mide sobre `amount`, asi que la comision va en su columna y no le come
	// tope a la persona — igual que en el resto de la aplicacion.
	if tipo != "crypto_send" || moneda != "USD" || monto != 8000 || comisionMinor != 20 {
		t.Fatalf("historial: %s %s %d (comision %d), esperaba crypto_send USD 8000 (20)",
			tipo, moneda, monto, comisionMinor)
	}

	if e.uif.veces != 1 {
		t.Fatalf("la UIF recibio %d avisos, esperaba 1", e.uif.veces)
	}
	if e.uif.moneda != "USD" || e.uif.montoMinor != 8000 || e.uif.deQuien != e.quienEnvia {
		t.Fatalf("aviso a la UIF: %s %d de %s, esperaba USD 8000 de quien envio",
			e.uif.moneda, e.uif.montoMinor, e.uif.deQuien)
	}
	if len(e.uif.movimientos) != 1 || e.uif.movimientos[0] != envio.ID {
		t.Fatalf("la UIF no quedo apuntando al movimiento del envio: %v", e.uif.movimientos)
	}
}

// El aviso es lo UNICO que tiene quien recibe para enterarse: no hay nada que
// le avise desde una cadena, porque no hay cadena. Y tiene que nombrar a quien
// ENVIA — la contraparte del envio es la persona a la que se le esta avisando.
func TestEnviarCripto_ElAvisoNombraAQuienEnvia(t *testing.T) {
	e := montarEnvio(t)

	if _, err := e.enviar(seEnvia, ""); err != nil {
		t.Fatalf("Send: %v", err)
	}

	if e.avisos.veces != 1 {
		t.Fatalf("se mandaron %d avisos, esperaba 1", e.avisos.veces)
	}
	if e.avisos.paraQuien != e.quienRecibe {
		t.Fatalf("el aviso fue para %s, esperaba para quien recibe", e.avisos.paraQuien)
	}
	if !strings.Contains(e.avisos.cuerpo, "Test User") {
		t.Fatalf("el aviso dice %q y no nombra a quien envia", e.avisos.cuerpo)
	}
	if strings.Contains(e.avisos.cuerpo, "Admin User") {
		t.Fatalf("el aviso dice %q: le esta diciendo a la persona que se lo envio ella misma",
			e.avisos.cuerpo)
	}
}

// ── Los envios que no deben ocurrir ─────────────────────────────────────────

// Reintentar con la misma llave devuelve el envio que ya se hizo, sin enviar
// otra vez. Es la garantia de que tocar "Enviar" dos veces por nervios, o que
// se corte la red y el telefono reintente, no cueste el doble.
func TestEnviarCripto_ElReintentoNoEnviaDosVeces(t *testing.T) {
	e := montarEnvio(t)
	ctx := context.Background()

	primero, err := e.enviar(seEnvia, "envio-de-prueba-1")
	if err != nil {
		t.Fatalf("primer envio: %v", err)
	}
	segundo, err := e.enviar(seEnvia, "envio-de-prueba-1")
	if err != nil {
		t.Fatalf("reintento: %v", err)
	}
	if segundo.ID != primero.ID {
		t.Fatalf("el reintento escribio otro envio (%s vs %s)", segundo.ID, primero.ID)
	}

	e.exigirSaldos(t, d(1).Sub(bajaDelSaldo), seEnvia)

	var comisiones int
	if err := e.pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM crypto_platform_fees`).Scan(&comisiones); err != nil {
		t.Fatalf("contar comisiones: %v", err)
	}
	if comisiones != 1 {
		t.Fatalf("se cobraron %d comisiones por un solo envio", comisiones)
	}
	// El aviso tampoco se repite: quien recibe no puede ver dos veces lo que le
	// llego una sola.
	if e.avisos.veces != 1 {
		t.Fatalf("se mandaron %d avisos por un solo envio", e.avisos.veces)
	}
}

// La llave la elige el cliente, asi que puede llegar repetida describiendo otra
// cosa. Devolver el envio viejo ahi seria decirle "enviado" a alguien cuyo
// destinatario nunca recibio nada.
func TestEnviarCripto_LaMismaLlaveParaOtraCosaSeRechaza(t *testing.T) {
	e := montarEnvio(t)

	if _, err := e.enviar(seEnvia, "llave-repetida"); err != nil {
		t.Fatalf("primer envio: %v", err)
	}

	_, err := e.enviar(seEnvia.Mul(d(2)), "llave-repetida")
	if !errors.Is(err, crypto.ErrLlaveDeOtroEnvio) {
		t.Fatalf("error = %v, esperaba ErrLlaveDeOtroEnvio", err)
	}
	// El primer envio queda intacto y el segundo no ocurrio.
	e.exigirSaldos(t, d(1).Sub(bajaDelSaldo), seEnvia)
}

// Enviarse a uno mismo no mueve nada y cobraria la comision: seria cobrar por
// nada.
func TestEnviarCripto_NoTePodesEnviarAVosMismo(t *testing.T) {
	e := montarEnvio(t)

	_, err := e.svc.Send(context.Background(), e.quienEnvia, &crypto.SendRequest{
		Asset: "BTC", Amount: seEnvia, QRData: e.miCodigo(t, e.quienEnvia),
	})
	if !errors.Is(err, crypto.ErrNoTePodesEnviar) {
		t.Fatalf("error = %v, esperaba ErrNoTePodesEnviar", err)
	}
	e.exigirQueNadaSeMovio(t)
}

// Un codigo que no existe se rechaza con el sentinela del lector de QR, sin
// traducirlo: la pantalla ya sabe responder a ese codigo porque es el mismo que
// recibe del pago por QR.
func TestEnviarCripto_UnCodigoQueNoExiste(t *testing.T) {
	e := montarEnvio(t)

	e.qrDelReceptor = "KIRAMO:PAY:este-codigo-no-existe:0:CRC"
	_, err := e.enviar(seEnvia, "")
	if !errors.Is(err, qrpayment.ErrQRInvalido) {
		t.Fatalf("error = %v, esperaba ErrQRInvalido", err)
	}
	e.exigirQueNadaSeMovio(t)
}

// Sin QR no hay destinatario, y antes que adivinar uno no se envia. Vale para
// la vista previa igual que para el envio: la hoja no puede llegar a mostrar un
// nombre inventado.
func TestEnviarCripto_SinCodigoNoHayDestinatario(t *testing.T) {
	e := montarEnvio(t)

	_, err := e.svc.PreviewSend(context.Background(), e.quienEnvia, &crypto.SendRequest{
		Asset: "BTC", Amount: seEnvia, QRData: "   ",
	})
	if !errors.Is(err, qrpayment.ErrQRInvalido) {
		t.Fatalf("PreviewSend = %v, esperaba ErrQRInvalido", err)
	}
	e.qrDelReceptor = ""
	if _, err := e.enviar(seEnvia, ""); !errors.Is(err, qrpayment.ErrQRInvalido) {
		t.Fatalf("Send = %v, esperaba ErrQRInvalido", err)
	}
	e.exigirQueNadaSeMovio(t)
}

// El rotulo de un comercio cobra en colones o dolares: no tiene donde recibir un
// activo. Se rechaza con el sentinela del comercio, no con uno generico, para
// que la pantalla pueda decir por que.
func TestEnviarCripto_ElRotuloDeUnComercioSeRechaza(t *testing.T) {
	e := montarEnvio(t)
	ctx := context.Background()

	m, err := e.qr.RegisterMerchant(ctx, e.quienRecibe, &qrpayment.RegisterMerchantRequest{
		Name: "Soda Tica", Category: "restaurant", Cedula: "3-101-123456",
		CedulaType: "juridica", LegalName: "Soda Tica SA",
	})
	if err != nil {
		t.Fatalf("registrar comercio: %v", err)
	}
	if _, err := e.qr.ApproveMerchant(ctx, m.ID, e.quienRecibe); err != nil {
		t.Fatalf("aprobar comercio: %v", err)
	}
	rotulo, err := e.qr.GetOrCreateMerchantCode(ctx, e.quienRecibe, m.ID, "", "CRC")
	if err != nil {
		t.Fatalf("rotulo del comercio: %v", err)
	}

	e.qrDelReceptor = rotulo.QRData
	if _, err := e.enviar(seEnvia, ""); !errors.Is(err, qrpayment.ErrQRDeComercio) {
		t.Fatalf("error = %v, esperaba ErrQRDeComercio", err)
	}
	e.exigirQueNadaSeMovio(t)
}

// Sin saldo no se envia, y sobre todo: no llega nada. Un envio a medias dejaria
// cripto creada de la nada.
func TestEnviarCripto_SinSaldoNoLlegaNada(t *testing.T) {
	e := montarEnvio(t)

	_, err := e.enviar(d(2), "")
	if !errors.Is(err, crypto.ErrSaldoDeActivoInsuficiente) {
		t.Fatalf("error = %v, esperaba ErrSaldoDeActivoInsuficiente", err)
	}
	e.exigirQueNadaSeMovio(t)
}

// El saldo justo tampoco alcanza: la comision la paga quien envia, asi que
// enviar TODO el saldo no se puede.
func TestEnviarCripto_ElSaldoTieneQueCubrirLaComision(t *testing.T) {
	e := montarEnvio(t)

	// Con llave del cliente se salta la comprobacion previa a proposito, para
	// que la prueba llegue hasta la guarda del descuento: esa es la unica
	// compuerta real, porque la comprobacion previa lee fuera de la transaccion.
	_, err := e.enviar(d(1), "envio-del-saldo-entero")
	if !errors.Is(err, crypto.ErrSaldoDeActivoInsuficiente) {
		t.Fatalf("error = %v, esperaba ErrSaldoDeActivoInsuficiente", err)
	}
	e.exigirQueNadaSeMovio(t)
}

// El tope diario frena el envio igual que frena una transferencia, y el envio
// frenado no deja nada a medias: las dos patas, la comision y la fila del
// historial confirman juntas o no confirma ninguna.
//
// 0,5 BTC a 1000 USD son 500 dolares, y el tope diario en dolares del monedero
// de prueba son 190.
func TestEnviarCripto_ElTopeDiarioLoFrena(t *testing.T) {
	e := montarEnvio(t)

	_, err := e.enviar(d(0.5), "")
	if !errors.Is(err, transaction.ErrDailyLimitExceeded) {
		t.Fatalf("error = %v, esperaba ErrDailyLimitExceeded", err)
	}
	e.exigirQueNadaSeMovio(t)
}

// Los montos altos piden segundo factor, con el mismo proposito que usa el
// resto de la aplicacion.
func TestEnviarCripto_ElMontoAltoPideSegundoFactor(t *testing.T) {
	e := montarEnvio(t)
	e.mfa.exige = true

	_, err := e.enviar(seEnvia, "")
	if !errors.Is(err, transaction.ErrMFARequired) {
		t.Fatalf("error = %v, esperaba ErrMFARequired", err)
	}
	if e.mfa.proposito != "high_value_tx" {
		t.Fatalf("proposito del desafio = %q, esperaba high_value_tx", e.mfa.proposito)
	}
	e.exigirQueNadaSeMovio(t)

	// Con el desafio pasado, el mismo envio sale.
	e.mfa.verificado = true
	if _, err := e.enviar(seEnvia, ""); err != nil {
		t.Fatalf("Send con MFA verificada: %v", err)
	}
	e.exigirSaldos(t, d(1).Sub(bajaDelSaldo), seEnvia)
}

// Sin precio no se envia. El precio no decide cuanto sale —eso lo dice la
// persona, en el propio activo— pero si cuanto VALE lo que sale, que es lo que
// miran el tope y la UIF. Contar cero seria dejar pasar por cripto justo lo que
// por transferencia se frena.
func TestEnviarCripto_SinPrecioNoSeEnvia(t *testing.T) {
	sinPrecios := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte("[]"))
	}))
	t.Cleanup(sinPrecios.Close)
	e := montarEnvioCon(t, sinPrecios.URL)

	_, err := e.enviar(seEnvia, "")
	if !errors.Is(err, crypto.ErrSinPrecio) {
		t.Fatalf("error = %v, esperaba ErrSinPrecio", err)
	}
	e.exigirQueNadaSeMovio(t)

	// La vista previa SI funciona con el feed caido: la comision es en el mismo
	// activo, asi que ninguno de los tres numeros que muestra depende del precio.
	vista, err := e.svc.PreviewSend(context.Background(), e.quienEnvia, &crypto.SendRequest{
		Asset: "BTC", Amount: seEnvia, QRData: e.qrDelReceptor,
	})
	if err != nil {
		t.Fatalf("PreviewSend sin precio: %v", err)
	}
	if !vista.Total.Equal(bajaDelSaldo) {
		t.Fatalf("la hoja mostro un total de %s sin precio, esperaba %s", vista.Total, bajaDelSaldo)
	}
}

// Sin con que leer un QR no hay forma de saber a quien le llegaria, asi que no
// se ofrece enviar. Es el servicio tal como queda si no se le pasan las
// Opciones del envio.
func TestEnviarCripto_SinLectorDeQRNoSeOfrece(t *testing.T) {
	svc, userID := setupCryptoService(t)

	_, err := svc.PreviewSend(context.Background(), userID, &crypto.SendRequest{
		Asset: "BTC", Amount: seEnvia, QRData: "lo-que-sea",
	})
	if !errors.Is(err, crypto.ErrEnvioNoDisponible) {
		t.Fatalf("PreviewSend = %v, esperaba ErrEnvioNoDisponible", err)
	}
	_, err = svc.Send(context.Background(), userID, &crypto.SendRequest{
		Asset: "BTC", Amount: seEnvia, QRData: "lo-que-sea",
	})
	if !errors.Is(err, crypto.ErrEnvioNoDisponible) {
		t.Fatalf("Send = %v, esperaba ErrEnvioNoDisponible", err)
	}
}
