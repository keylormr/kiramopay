package crypto_test

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
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
	// falla, si no es nil, es lo que devuelve NotifyUser: el envio ya se
	// confirmo antes de avisar, asi que un aviso que falla no lo puede tumbar.
	falla error
}

func (a *avisosDePrueba) NotifyUser(_ context.Context, userID, _, body, _ string) error {
	a.paraQuien, a.cuerpo = userID, body
	a.veces++
	return a.falla
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
	// urlPrecios recuerda el stub de precios con el que se armo el entorno. La
	// prueba de la carrera del reintento necesita montar un SEGUNDO servicio,
	// igual en todo salvo el pool, contra la MISMA base ya sembrada, y sin este
	// campo no tendria como apuntarlo al mismo stub.
	urlPrecios string
}

// servicioDeEnvio arma el servicio de envio de verdad a partir de un pool
// dado, con los MISMOS colaboradores de prueba (avisos, MFA, UIF) que ya trae
// el entorno. Existe aparte de montarEnvioCon porque la prueba de la carrera
// del reintento necesita un SEGUNDO servicio sobre OTRO pool -el que trae el
// trazador de consultas- contra la base que montarEnvio ya sembro; llamar de
// nuevo a montarEnvioCon no sirve porque usa testutil.TestDB, que crea el
// esquema y TRUNCA las tablas, borrando lo que la prueba ya puso.
func servicioDeEnvio(pool *pgxpool.Pool, urlPrecios string, e *entornoDeEnvio) *crypto.Service {
	repo := crypto.NewRepository(pool)
	precios := crypto.NewPriceService()
	precios.SetBaseURL(urlPrecios)
	l := ledger.NewEngine(pool, slog.New(slog.NewJSONHandler(os.Stdout, nil)))
	txSvc := transaction.NewService(transaction.NewRepository(pool), wallet.NewRepository(pool), l, nil)
	qrSvc := qrpayment.NewService(qrpayment.NewRepository(pool), txSvc, user.NewRepository(pool), nil)
	return crypto.NewService(repo, precios, txSvc,
		func(context.Context, string, string) (float64, error) { return 500, nil },
		&crypto.Opciones{
			Destinatarios: qrSvc,
			MFA:           e.mfa,
			UIF:           e.uif,
			Avisos:        e.avisos,
		})
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

	txSvc := transaction.NewService(transaction.NewRepository(pool), wallet.NewRepository(pool),
		ledger.NewEngine(pool, slog.New(slog.NewJSONHandler(os.Stdout, nil))), nil)
	qrSvc := qrpayment.NewService(qrpayment.NewRepository(pool), txSvc, user.NewRepository(pool), nil)

	e := &entornoDeEnvio{
		pool:       pool,
		qr:         qrSvc,
		urlPrecios: urlPrecios,
		avisos:     &avisosDePrueba{},
		mfa:        &mfaDePrueba{},
		uif:        &uifDePrueba{},
	}
	e.svc = servicioDeEnvio(pool, urlPrecios, e)

	pinHash, _ := hash.HashPin("1234")
	e.quienEnvia = testutil.SeedTestUser(t, pool, "702650930", pinHash)
	e.quienRecibe = testutil.SeedTestUser2(t, pool)

	// Un bitcoin entero para quien envia. Entra por el mismo camino que una
	// compra, asi el promedio de costo queda puesto y el saldo es real.
	repo := crypto.NewRepository(pool)
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

	// Enviar 1 BTC entero, al precio del stub (1000 USD), vale 1000 dolares:
	// muy por encima de los 190 del tope diario de prueba. Dentro de la
	// transaccion el orden es el tope primero (AntesDeMover) y el saldo despues
	// (moverLosDosSaldos), asi que con el tope de fabrica esta prueba nunca
	// llegaria a la guarda que dice probar — la frenaria el tope, no el saldo, y
	// TestEnviarCripto_ElTopeDiarioLoFrena ya cubre ese caso. Se sube el tope
	// SOLO para el monedero de quien envia, con un UPDATE explicito: la base de
	// pruebas se trunca entera entre pruebas (testutil.TestDB), asi que esto no
	// se filtra a ninguna otra.
	if _, err := e.pool.Exec(context.Background(),
		`UPDATE wallets SET daily_limit_usd = 200000, monthly_limit_usd = 200000 WHERE user_id = $1::uuid`,
		e.quienEnvia,
	); err != nil {
		t.Fatalf("subir el tope de esta prueba: %v", err)
	}

	// OJO: con llave del cliente, esta prueba YA NO llega a la guarda del
	// descuento (descontarActivo, "balance >= $3"). "envio-del-saldo-entero" es
	// una llave nueva, asi que el pre-chequeo de saldoAlcanza —que lee FUERA de
	// la transaccion— la frena antes de tocar la base. Lo que aqui se prueba es
	// ese pre-chequeo, no la guarda SQL; quien prueba la guarda en si, llamando
	// al repositorio sin el servicio de por medio, es
	// TestEnviarEnUnaTxRespetaLaGuardaDeSaldoSinElPreChequeoDelServicio.
	_, err := e.enviar(d(1), "envio-del-saldo-entero")
	if !errors.Is(err, crypto.ErrSaldoDeActivoInsuficiente) {
		t.Fatalf("error = %v, esperaba ErrSaldoDeActivoInsuficiente", err)
	}
	e.exigirQueNadaSeMovio(t)
}

// La guarda de verdad (descontarActivo, "balance >= $3") dejo de tener una
// prueba deterministica cuando la llave del cliente empezo a pre-chequear el
// saldo: para una llave nueva, ese pre-chequeo ahora intercepta el envio antes
// de llegar a la base, y la unica prueba que todavia toca la guarda es la
// carrera de mas abajo, que depende de que las dos goroutines de verdad se
// solapen. Esta prueba llama al repositorio DIRECTO, sin el servicio de por
// medio, para que la guarda siga probada sin depender de una carrera.
func TestEnviarEnUnaTxRespetaLaGuardaDeSaldoSinElPreChequeoDelServicio(t *testing.T) {
	e := montarEnvio(t)
	ctx := context.Background()
	repo := crypto.NewRepository(e.pool)

	envio := &crypto.TransactionRecord{
		UserID: e.quienEnvia, Type: "send", Asset: "BTC",
		Amount: d(1), Price: d(1000), Total: d(1.0025), Currency: "BTC",
		Fee: d(0.0025), Status: "completed",
		CounterpartyUserID: e.quienRecibe, IdempotencyKey: "directo-al-repositorio-sin-saldo",
	}
	recibo := &crypto.TransactionRecord{
		UserID: e.quienRecibe, Type: "receive", Asset: "BTC",
		Amount: d(1), Price: d(1000), Total: d(1), Currency: "BTC",
		Fee: decimal.Zero, Status: "completed", CounterpartyUserID: e.quienEnvia,
	}

	// Saldo de quien envia: 1 BTC (sembrado por montarEnvio). Total pedido:
	// 1,0025 BTC. Sin ningun pre-chequeo de por medio —AntesDeMover va nil—,
	// lo unico que puede rechazar este envio es la guarda SQL.
	_, _, err := repo.EnviarEnUnaTx(ctx, &crypto.DatosDelEnvio{
		Envio: envio, Recibo: recibo, NombreDelActivo: "Bitcoin", PrecioUSD: d(1000),
	})
	if !errors.Is(err, crypto.ErrSaldoDeActivoInsuficiente) {
		t.Fatalf("error = %v, esperaba ErrSaldoDeActivoInsuficiente", err)
	}
	e.exigirSaldos(t, d(1), decimal.Zero)
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

// ── Caminos del dinero que faltaban por ejercitar ──────────────────────────

// El precio que la pantalla mostro y el que rige al enviar tienen que seguir
// cerca: comprar y vender ya lo comprueban, enviar tambien llama a
// comprobarDesviacion pero ninguna prueba se lo hacia pasar por esta guarda.
func TestEnviarCripto_PrecioMovidoSeRechaza(t *testing.T) {
	e := montarEnvio(t)

	_, err := e.svc.Send(context.Background(), e.quienEnvia, &crypto.SendRequest{
		Asset: "BTC", Amount: seEnvia, QRData: e.qrDelReceptor,
		Price: d(1), // el mercado dice 1000: nada que ver con lo que vio la pantalla
	})
	if !errors.Is(err, crypto.ErrPrecioMovido) {
		t.Fatalf("error = %v, esperaba ErrPrecioMovido", err)
	}
	e.exigirQueNadaSeMovio(t)
}

// Send llama a validarCantidad antes de tocar la base: cero, negativo o mas
// decimales de los que la columna admite (18) se rechazan sin abrir ningun
// asiento.
func TestEnviarCripto_CantidadInvalidaSeRechazaAntesDeTocarLaBase(t *testing.T) {
	e := montarEnvio(t)

	casos := map[string]decimal.Decimal{
		"cero":                decimal.Zero,
		"negativo":            d(-0.01),
		"mas de 18 decimales": decimal.RequireFromString("0.1234567890123456789"),
	}
	for nombre, monto := range casos {
		if _, err := e.enviar(monto, ""); !errors.Is(err, crypto.ErrMontoInvalido) {
			t.Fatalf("%s: error = %v, esperaba ErrMontoInvalido", nombre, err)
		}
	}
	e.exigirQueNadaSeMovio(t)
}

// La regresion que este PR corrige: con llave del cliente, la comprobacion
// previa de saldo no corria NUNCA, asi que un envio sin saldo Y por encima del
// tope diario mostraba "supero el tope" — el rechazo menos util, porque
// sugiere reintentar manana cuando lo que falta es saldo. Esta prueba tiene
// que fallar contra el codigo de antes de este PR.
func TestEnviarCripto_ConLlaveYSinSaldoElErrorEsDeSaldoNoDeTope(t *testing.T) {
	e := montarEnvio(t)

	// 1 BTC entero: mas de lo que hay (falta lo de la comision) y, a 1000
	// dolares, muy por encima del tope diario de prueba (190). El error que
	// describe lo que de verdad paso es el de saldo.
	_, err := e.enviar(d(1), "envio-con-llave-sin-saldo")
	if !errors.Is(err, crypto.ErrSaldoDeActivoInsuficiente) {
		t.Fatalf("error = %v, esperaba ErrSaldoDeActivoInsuficiente", err)
	}
	e.exigirQueNadaSeMovio(t)
}

// La garantia que la regresion de arriba no puede romper: un reintento con la
// MISMA llave sigue siendo idempotente aunque el saldo ya no alcance para
// volver a intentarlo. Si el arreglo del saldo llegara a correr tambien
// cuando la llave YA tiene un envio escrito, este reintento fallaria por
// saldo insuficiente en vez de devolver el envio guardado.
func TestEnviarCripto_ElReintentoSigueSiendoIdempotenteAunqueElSaldoYaNoAlcance(t *testing.T) {
	e := montarEnvio(t)
	ctx := context.Background()

	monto := d(0.18)
	total := d(0.18045) // 0,18 mas su comision de 0,25 %: justo lo que hay

	// Se deja el saldo justo para ESTE envio, para que el primero lo consuma
	// entero. La base de pruebas se trunca entre pruebas (testutil.TestDB),
	// asi que este UPDATE no se filtra a ninguna otra.
	if _, err := e.pool.Exec(ctx,
		`UPDATE crypto_assets SET balance = $2 WHERE user_id = $1::uuid AND symbol = 'BTC'`,
		e.quienEnvia, total,
	); err != nil {
		t.Fatalf("dejar el saldo justo para el envio: %v", err)
	}

	primero, err := e.enviar(monto, "reintento-con-el-saldo-agotado")
	if err != nil {
		t.Fatalf("primer envio: %v", err)
	}
	e.exigirSaldos(t, decimal.Zero, monto)

	segundo, err := e.enviar(monto, "reintento-con-el-saldo-agotado")
	if err != nil {
		t.Fatalf("reintento con el saldo ya en cero: %v", err)
	}
	if segundo.ID != primero.ID {
		t.Fatalf("el reintento escribio otro envio (%s vs %s)", segundo.ID, primero.ID)
	}
	e.exigirSaldos(t, decimal.Zero, monto)
}

// Dos envios del mismo activo a la vez, sobre un saldo que no les alcanza a
// los dos juntos: tiene que ganar exactamente uno, el saldo final tiene que
// quedar correcto al centimo y no puede quedar ni saldo negativo ni una
// comision de mas. Vender, staking y convertir ya tienen esta prueba de
// carrera (sync.WaitGroup); enviar no la tenia, y un doble gasto por carrera
// pasaria con el CI en verde: la comprobacion previa del servicio lee FUERA de
// la transaccion, y lo unico que de verdad frena es la guarda de
// descontarActivo (balance >= $3).
func TestEnviarCripto_DosEnviosSimultaneosNoEnvianMasDeLoQueHay(t *testing.T) {
	e := montarEnvio(t)
	ctx := context.Background()

	// Se recorta el saldo a 0,1 BTC: alcanza para UNO de los dos intentos
	// (cada uno baja 0,06015) pero no para los dos juntos (0,1203). En
	// dolares cada intento vale 60 y los dos juntos 120, bien por debajo del
	// tope diario de prueba (190): quien pierda la carrera tiene que perder
	// por saldo, no por tope.
	if _, err := e.pool.Exec(ctx,
		`UPDATE crypto_assets SET balance = $2 WHERE user_id = $1::uuid AND symbol = 'BTC'`,
		e.quienEnvia, d(0.1),
	); err != nil {
		t.Fatalf("recortar el saldo para la carrera: %v", err)
	}

	monto := d(0.06)
	var wg sync.WaitGroup
	errs := make([]error, 2)
	for i := range errs {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_, errs[i] = e.enviar(monto, "")
		}(i)
	}
	wg.Wait()

	exitos := 0
	for _, err := range errs {
		switch {
		case err == nil:
			exitos++
		case !errors.Is(err, crypto.ErrSaldoDeActivoInsuficiente):
			t.Fatalf("el envio perdedor fallo por otra causa: %v", err)
		}
	}
	if exitos != 1 {
		t.Fatalf("envios exitosos = %d, se esperaba 1 (errs=%v)", exitos, errs)
	}

	e.exigirSaldos(t, d(0.1).Sub(d(0.06015)), monto)

	var comisiones int
	if err := e.pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM crypto_platform_fees`).Scan(&comisiones); err != nil {
		t.Fatalf("contar comisiones: %v", err)
	}
	if comisiones != 1 {
		t.Fatalf("se cobraron %d comisiones por un solo envio ganador", comisiones)
	}
}

// La misma carrera de arriba, pero con la MISMA llave de idempotencia en las
// dos llamadas — el caso que el arreglo de la llave del cliente dice proteger
// y que ninguna prueba ejercitaba: la de arriba usa llave vacia en las dos
// (cada una genera la suya propia) y la del reintento idempotente las manda
// una despues de la otra, nunca las dos en vuelo a la vez.
//
// Con llave compartida la proteccion no es la guarda de saldo: es el indice
// unico de EnviarEnUnaTx. La segunda insercion se bloquea contra la primera
// hasta que esta resuelve, y cae al camino de "repetido" sin haber tocado el
// saldo — asi que, a diferencia de la carrera con llaves distintas, las DOS
// llamadas tienen que terminar en err == nil y con el MISMO envio.
func TestEnviarCripto_DosEnviosSimultaneosConLaMismaLlaveNoDuplicanNiFallan(t *testing.T) {
	e := montarEnvio(t)
	ctx := context.Background()

	// Mismo recorte que la carrera de llaves distintas: alcanza para uno de
	// los dos intentos, no para los dos juntos. Con llave compartida el saldo
	// nunca baja dos veces, pero el recorte deja la prueba blindada si algun
	// dia el bloqueo del indice dejara de aplicar.
	if _, err := e.pool.Exec(ctx,
		`UPDATE crypto_assets SET balance = $2 WHERE user_id = $1::uuid AND symbol = 'BTC'`,
		e.quienEnvia, d(0.1),
	); err != nil {
		t.Fatalf("recortar el saldo para la carrera: %v", err)
	}

	monto := d(0.06)
	const llave = "carrera-con-la-misma-llave"
	var wg sync.WaitGroup
	resultados := make([]*crypto.TransactionRecord, 2)
	errs := make([]error, 2)
	for i := range errs {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			resultados[i], errs[i] = e.enviar(monto, llave)
		}(i)
	}
	wg.Wait()

	for i, err := range errs {
		if err != nil {
			t.Fatalf("envio %d con llave compartida devolvio error: %v", i, err)
		}
	}
	if resultados[0].ID != resultados[1].ID {
		t.Fatalf("la misma llave produjo dos envios distintos: %s vs %s", resultados[0].ID, resultados[1].ID)
	}

	// Un solo debito real: 0,1 BTC menos lo que baja UN envio, no dos.
	e.exigirSaldos(t, d(0.1).Sub(d(0.06015)), monto)

	var comisiones int
	if err := e.pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM crypto_platform_fees`).Scan(&comisiones); err != nil {
		t.Fatalf("contar comisiones: %v", err)
	}
	if comisiones != 1 {
		t.Fatalf("se cobraron %d comisiones por un envio que se repitio", comisiones)
	}
}

// El aviso es de mejor esfuerzo y corre DESPUES de confirmar: si falla, el
// envio ya ocurrido no se puede deshacer. Antes de esta prueba, el doble de
// avisos siempre devolvia nil, asi que esta rama nunca se ejercitaba.
func TestEnviarCripto_UnAvisoQueFallaNoTumbaElEnvioYaConfirmado(t *testing.T) {
	e := montarEnvio(t)
	e.avisos.falla = errors.New("push caido")

	if _, err := e.enviar(seEnvia, ""); err != nil {
		t.Fatalf("Send con el aviso caido: %v", err)
	}
	e.exigirSaldos(t, d(1).Sub(bajaDelSaldo), seEnvia)
	if e.avisos.veces != 1 {
		t.Fatalf("se intento avisar %d veces, esperaba 1", e.avisos.veces)
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

// ---------------------------------------------------------------------------
// La carrera del reintento contra un envio que esta CONFIRMANDO de verdad.
//
// Con llave del cliente, Send hace dos lecturas SUELTAS -la de la llave
// (MovimientoPorLlave) y la del saldo (saldoAlcanza)- las dos fuera de toda
// transaccion y sin candado. Si el envio ORIGINAL confirma justo entre esas
// dos lecturas, el reintento lee "esa llave no tiene envio" y despues lee un
// saldo YA debitado: contesta "no alcanza" por un envio que SI ocurrio. La
// persona ve un error de saldo insuficiente por una plata que en realidad ya
// se le fue.
//
// Esta prueba fuerza ese entrelazado de verdad, sin dormir a ciegas: congela
// el envio original a mitad de su propia transaccion (en el MISMO candado de
// fila que toparElGasto toma en produccion, "wallets ... FOR UPDATE"),
// arranca el reintento con un trazador que avisa justo cuando termina la
// PRIMERA de sus dos lecturas del pre-chequeo, y en ese instante suelta el
// candado y espera a que el original CONFIRME de verdad antes de dejar que el
// reintento siga. Sin esta prueba, nada en el paquete ejercita ese
// entrelazado: las carreras que ya existen (mas abajo) sueltan dos goroutines
// libres, sin ningun punto de sincronizacion, y casi nunca caen justo en la
// ventana de dos lecturas que este defecto necesita.

// claveDelSQLDeEnvio es la llave del contexto donde trazadorDelPreChequeoDeEnvio
// guarda el texto de la consulta entre TraceQueryStart y TraceQueryEnd.
type claveDelSQLDeEnvio struct{}

// trazadorDelPreChequeoDeEnvio avisa UNA SOLA VEZ, justo cuando TERMINA la
// primera de las dos lecturas sueltas del pre-chequeo del envio: la de
// crypto_assets (saldoAlcanza) o la de idempotency_key (MovimientoPorLlave). Cual
// de las dos sea la primera depende de si el arreglo ya esta aplicado o no, y
// por eso el trazador no elige una: vigila las dos, para que la MISMA prueba
// sirva de guardian antes y despues del arreglo.
type trazadorDelPreChequeoDeEnvio struct {
	hook      func()
	unaVez    sync.Once
	disparado bool
}

func (tz *trazadorDelPreChequeoDeEnvio) TraceQueryStart(ctx context.Context, _ *pgx.Conn, datos pgx.TraceQueryStartData) context.Context {
	return context.WithValue(ctx, claveDelSQLDeEnvio{}, datos.SQL)
}

func (tz *trazadorDelPreChequeoDeEnvio) TraceQueryEnd(ctx context.Context, _ *pgx.Conn, _ pgx.TraceQueryEndData) {
	sql, _ := ctx.Value(claveDelSQLDeEnvio{}).(string)
	if !strings.Contains(sql, "FROM crypto_assets") && !strings.Contains(sql, "idempotency_key = $2") {
		return
	}
	tz.unaVez.Do(func() {
		tz.disparado = true
		tz.hook()
	})
}

// esperarEnvio sondea condicion hasta que sea verdadera o pase el plazo.
// Nunca se cuelga: si la condicion nunca se cumple, marca la prueba en rojo
// con t.Errorf y devuelve false para que quien llama decida como cortar
// limpio (soltar candados, esperar goroutines) antes de salir. Un timeout
// aqui es SIEMPRE un defecto de la prueba o de la carrera, nunca algo que CI
// deba esperar dormido.
func esperarEnvio(t *testing.T, descripcion string, condicion func() bool) bool {
	t.Helper()
	plazo := time.After(5 * time.Second)
	pulso := time.NewTicker(5 * time.Millisecond)
	defer pulso.Stop()
	for {
		if condicion() {
			return true
		}
		select {
		case <-plazo:
			t.Errorf("nunca ocurrio: %s", descripcion)
			return false
		case <-pulso.C:
		}
	}
}

// esperarAlOriginal espera a que termine la goroutine del envio original, pero
// con plazo propio. Un wg.Wait() pelado se colgaria hasta que se agote el
// plazo global de `go test` -300 segundos en CI, para TODO ./internal/...- y
// la falla llegaria como un volcado de goroutines sin decir que paso. Con
// plazo, si el original se cuelga por algo ajeno a la carrera que esta prueba
// fuerza, la prueba corta rapido y con su propio mensaje.
func esperarAlOriginal(t *testing.T, wg *sync.WaitGroup) {
	t.Helper()
	listo := make(chan struct{})
	go func() {
		wg.Wait()
		close(listo)
	}()
	select {
	case <-listo:
	case <-time.After(10 * time.Second):
		t.Fatal("el envio original nunca termino: se colgo por algo ajeno a la carrera que esta prueba fuerza")
	}
}

// bloqueadaLaBilleteraDe es la unica forma, desde AFUERA de la transaccion del
// envio original, de saber que ya escribio su fila (con la llave, sin
// confirmar) y quedo esperando el candado de wallets -el mismo que esta
// prueba toma primero, a proposito, para congelarlo ahi. Sin esta espera la
// prueba soltaria su candado a ciegas: si lo suelta antes de que el original
// siquiera lo pida, el original nunca se congela y la carrera que se quiere
// forzar no ocurre.
func bloqueadaLaBilleteraDe(t *testing.T, pool *pgxpool.Pool) bool {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	var bloqueada bool
	if err := pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM pg_stat_activity
			WHERE datname = current_database()
			  AND wait_event_type = 'Lock'
			  AND query ILIKE '%FROM wallets%FOR UPDATE%'
		)`).Scan(&bloqueada); err != nil {
		t.Fatalf("preguntar por el candado de la billetera: %v", err)
	}
	return bloqueada
}

// envioConfirmado pregunta, desde OTRA conexion, si ya hay una fila visible en
// crypto_transactions para esa llave. Bajo aislamiento read committed -el que
// usa Postgres por defecto- una fila que otra transaccion inserto solo se
// vuelve visible DESPUES de que esa transaccion confirma: "existe" aqui ya
// quiere decir "el envio original confirmo de verdad", sin tener que mirar
// ninguna columna de estado.
func envioConfirmado(t *testing.T, pool *pgxpool.Pool, userID, llave string) bool {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	var existe bool
	if err := pool.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM crypto_transactions WHERE user_id = $1::uuid AND idempotency_key = $2)`,
		userID, llave,
	).Scan(&existe); err != nil {
		t.Fatalf("preguntar si el envio original ya confirmo: %v", err)
	}
	return existe
}

func TestEnviarCripto_ElReintentoNoRechazaElEnvioQueEstaConfirmando(t *testing.T) {
	e := montarEnvio(t)
	ctx := context.Background()

	// El saldo se recorta a EXACTAMENTE lo que baja un envio de 0,18 BTC (el
	// monto mas su comision de 0,25 %), para que quede en CERO justo cuando
	// el original confirma. 0,18 BTC al precio del stub (1000 USD) son 180
	// dolares, bajo el tope diario de 190 del monedero de prueba; 0,19 ya no
	// entraria, y la prueba fallaria por tope en vez de por lo que quiere
	// probar.
	const llave = "envio-que-esta-confirmando"
	monto := d(0.18)
	total := d(0.18045) // 0,18 mas su comision de 0,25 %
	if _, err := e.pool.Exec(ctx,
		`UPDATE crypto_assets SET balance = $2 WHERE user_id = $1::uuid AND symbol = 'BTC'`,
		e.quienEnvia, total,
	); err != nil {
		t.Fatalf("dejar el saldo justo para el envio: %v", err)
	}

	// Una conexion PROPIA, con su propia transaccion sin confirmar, toma el
	// MISMO candado que toparElGasto toma en produccion (CheckLimitsConBloqueoEnTx):
	// "SELECT 1 FROM wallets WHERE user_id = $1 FOR UPDATE". El envio
	// original va a insertar su fila (con la llave, sin confirmar) y va a
	// quedar esperando este candado, congelado a mitad de su propia
	// transaccion, sin haber movido un solo saldo todavia.
	conn, err := e.pool.Acquire(ctx)
	if err != nil {
		t.Fatalf("tomar una conexion para el candado: %v", err)
	}
	defer conn.Release()
	txCandado, err := conn.Begin(ctx)
	if err != nil {
		t.Fatalf("abrir la transaccion que congela el envio: %v", err)
	}
	var soltarloUnaVez sync.Once
	soltar := func() {
		soltarloUnaVez.Do(func() {
			_ = txCandado.Rollback(context.Background())
		})
	}
	defer soltar()
	if _, err := txCandado.Exec(ctx,
		`SELECT 1 FROM wallets WHERE user_id = $1::uuid FOR UPDATE`, e.quienEnvia,
	); err != nil {
		t.Fatalf("tomar el candado de la billetera: %v", err)
	}

	var original *crypto.TransactionRecord
	var errOriginal error
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		original, errOriginal = e.enviar(monto, llave)
	}()

	if !esperarEnvio(t, "el envio original queda esperando el candado de la billetera", func() bool {
		return bloqueadaLaBilleteraDe(t, e.pool)
	}) {
		soltar()
		esperarAlOriginal(t, &wg)
		t.FailNow()
	}

	// El reintento corre en un servicio IGUAL al original salvo en el pool:
	// este trae un trazador que avisa justo cuando termina la PRIMERA de las
	// dos lecturas sueltas del pre-chequeo -la llave o el saldo, la que sea
	// que el orden vigente consulte primero-. En ese instante, y solo en ese
	// instante, se suelta el candado de la billetera y se espera a que el
	// envio original CONFIRME de verdad, para que lo que el reintento haga
	// DESPUES de esa lectura encuentre el mundo ya cambiado por el original.
	trazador := &trazadorDelPreChequeoDeEnvio{hook: func() {
		soltar()
		esperarEnvio(t, "el envio original confirma en crypto_transactions", func() bool {
			return envioConfirmado(t, e.pool, e.quienEnvia, llave)
		})
	}}
	reintento := servicioDeEnvio(testutil.PoolTrazado(t, trazador), e.urlPrecios, e)
	repetido, errRepetido := reintento.Send(ctx, e.quienEnvia, &crypto.SendRequest{
		Asset: "BTC", Amount: monto, QRData: e.qrDelReceptor, IdempotencyKey: llave,
	})

	soltar()
	esperarAlOriginal(t, &wg)

	if !trazador.disparado {
		t.Fatal("el trazador nunca vio una consulta del pre-chequeo: la prueba no ejercito la carrera")
	}
	if errOriginal != nil {
		t.Fatalf("el envio original: %v", errOriginal)
	}
	if errRepetido != nil {
		t.Fatalf("el reintento de un envio que SI se confirmo devolvio error: %v", errRepetido)
	}
	if repetido.ID != original.ID {
		t.Fatalf("el reintento devolvio el envio %s, pero el que se confirmo fue %s", repetido.ID, original.ID)
	}

	e.exigirSaldos(t, decimal.Zero, monto)

	var comisiones int
	if err := e.pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM crypto_platform_fees`).Scan(&comisiones); err != nil {
		t.Fatalf("contar comisiones: %v", err)
	}
	if comisiones != 1 {
		t.Fatalf("se cobraron %d comisiones por un envio que se repitio", comisiones)
	}
}
