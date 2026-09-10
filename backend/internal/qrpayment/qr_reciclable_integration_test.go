package qrpayment_test

import (
	"context"
	"errors"
	"strconv"
	"strings"
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/kiramopay/backend/internal/qrpayment"
	"github.com/kiramopay/backend/internal/testutil"
)

// Estas pruebas cubren el QR reciclable: la identidad permanente que se imprime
// y se pega, y el cobro efimero que aparece en la pantalla del cajero.
//
// La propiedad que mas importa, y la que ninguna prueba vigilaba antes: PERDER
// LA CARRERA POR UN COBRO NO CUESTA UN CENTIMO. El reclamo corre dentro de la
// transaccion del asiento, asi que al segundo pagador no se le debita nada.

func comercioVerificado(t *testing.T, svc *qrpayment.Service, owner string) *qrpayment.Merchant {
	t.Helper()
	ctx := context.Background()
	m, err := svc.RegisterMerchant(ctx, owner, &qrpayment.RegisterMerchantRequest{
		Name: "Soda Tica", Category: "restaurant", Cedula: "3-101-123",
		CedulaType: "juridica", LegalName: "Soda Tica SA",
	})
	if err != nil {
		t.Fatalf("register merchant: %v", err)
	}
	if _, err := svc.ApproveMerchant(ctx, m.ID, owner); err != nil {
		t.Fatalf("approve merchant: %v", err)
	}
	return m
}

func rotuloDelComercio(t *testing.T, svc *qrpayment.Service, owner, merchantID string) *qrpayment.QRPaymentCode {
	t.Helper()
	code, err := svc.GetOrCreateMerchantCode(context.Background(), owner, merchantID, "", "CRC")
	if err != nil {
		t.Fatalf("rotulo del comercio: %v", err)
	}
	return code
}

func cobrar(t *testing.T, svc *qrpayment.Service, userID, codeID string, monto int64) *qrpayment.QRCharge {
	t.Helper()
	c, err := svc.CreateCharge(context.Background(), userID, &qrpayment.CreateChargeRequest{
		QRCodeID: codeID, Amount: monto,
	})
	if err != nil {
		t.Fatalf("crear cobro: %v", err)
	}
	return c
}

// ── El rotulo permanente ────────────────────────────────────────────────────

// Abrir "Cobrar" N veces deja UNA sola fila. Antes cada toque creaba una
// identidad nueva, permanente y pagable para siempre.
func TestElRotuloEsUnoSolo(t *testing.T) {
	svc, pool, _, owner := setupQR(t)
	ctx := context.Background()

	primero, err := svc.GetOrCreateMyCode(ctx, owner, "CRC")
	if err != nil {
		t.Fatalf("GetOrCreateMyCode: %v", err)
	}
	for i := 0; i < 5; i++ {
		otro, err := svc.GetOrCreateMyCode(ctx, owner, "CRC")
		if err != nil {
			t.Fatalf("GetOrCreateMyCode %d: %v", i, err)
		}
		if otro.ID != primero.ID {
			t.Fatalf("toque %d devolvio otro codigo (%s vs %s)", i, otro.ID, primero.ID)
		}
	}

	var n int
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM qr_payment_codes
		  WHERE creator_id = $1::uuid AND merchant_id IS NULL AND status = 'active'`,
		owner).Scan(&n); err != nil {
		t.Fatalf("contar codigos: %v", err)
	}
	if n != 1 {
		t.Fatalf("codigos activos = %d, se esperaba 1", n)
	}
}

// Y bajo carrera tambien: el get-or-create se apoya en el indice unico parcial,
// no en un SELECT previo.
func TestElRotuloEsUnoSoloBajoCarrera(t *testing.T) {
	svc, pool, _, owner := setupQR(t)
	ctx := context.Background()

	var wg sync.WaitGroup
	errs := make([]error, 6)
	for i := range errs {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_, errs[i] = svc.GetOrCreateMyCode(ctx, owner, "CRC")
		}(i)
	}
	wg.Wait()

	for i, err := range errs {
		if err != nil {
			t.Fatalf("toque %d: %v", i, err)
		}
	}
	var n int
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM qr_payment_codes
		  WHERE creator_id = $1::uuid AND merchant_id IS NULL AND status = 'active'`,
		owner).Scan(&n); err != nil {
		t.Fatalf("contar codigos: %v", err)
	}
	if n != 1 {
		t.Fatalf("codigos activos = %d, se esperaba 1", n)
	}
}

// El rotulo no lleva el UUID de quien cobra: se imprime y se pega a la vista de
// cualquiera.
func TestElRotuloNoFiltraElUuidDelCobrador(t *testing.T) {
	svc, _, _, owner := setupQR(t)
	code, err := svc.GetOrCreateMyCode(context.Background(), owner, "CRC")
	if err != nil {
		t.Fatalf("GetOrCreateMyCode: %v", err)
	}
	if strings.Contains(code.QRData, owner[:8]) {
		t.Fatalf("el payload lleva el id del cobrador: %s", code.QRData)
	}
	if !strings.Contains(code.QRData, ":0:CRC:i") {
		t.Fatalf("el rotulo deberia ser de monto abierto y con prefijo i: %s", code.QRData)
	}
}

// ── La carrera por un cobro ─────────────────────────────────────────────────

// LA PRUEBA QUE MAS IMPORTA. Dos personas pagan el mismo cobro a la vez: una
// gana, la otra recibe COBRO_YA_PAGADO, y a la que perdio NO SE LE DEBITA NADA.
//
// Antes el reclamo corria DESPUES de mover el dinero y en modo best-effort:
// perder la carrera costaba el monto entero.
func TestDosPagadoresCompitenPorElMismoCobro(t *testing.T) {
	svc, pool, payer, owner := setupQR(t)
	ctx := context.Background()
	segundo := testutil.SeedTestUser3(t, pool)

	m := comercioVerificado(t, svc, owner)
	code := rotuloDelComercio(t, svc, owner, m.ID)
	const monto int64 = 100000
	cobro := cobrar(t, svc, owner, code.ID, monto)

	saldo1, saldo2 := walletCRC(t, pool, payer), walletCRC(t, pool, segundo)

	var wg sync.WaitGroup
	errs := make([]error, 2)
	pagadores := []string{payer, segundo}
	for i, uid := range pagadores {
		wg.Add(1)
		go func(i int, uid string) {
			defer wg.Done()
			_, errs[i] = svc.ScanAndPay(ctx, uid, &qrpayment.ScanQRPaymentRequest{
				QRData: cobro.QRData, Currency: "CRC",
			})
		}(i, uid)
	}
	wg.Wait()

	exitos, rechazos := 0, 0
	for _, err := range errs {
		switch {
		case err == nil:
			exitos++
		case errors.Is(err, qrpayment.ErrCobroYaPagado):
			rechazos++
		default:
			t.Fatalf("error inesperado: %v", err)
		}
	}
	if exitos != 1 || rechazos != 1 {
		t.Fatalf("exitos=%d rechazos=%d, se esperaba 1 y 1 (errs=%v)", exitos, rechazos, errs)
	}

	// Uno pago; al otro no se le movio un centimo.
	final1, final2 := walletCRC(t, pool, payer), walletCRC(t, pool, segundo)
	debitados := 0
	if final1 == saldo1-monto {
		debitados++
	} else if final1 != saldo1 {
		t.Fatalf("saldo del primero = %d, se esperaba %d o %d", final1, saldo1, saldo1-monto)
	}
	if final2 == saldo2-monto {
		debitados++
	} else if final2 != saldo2 {
		t.Fatalf("saldo del segundo = %d, se esperaba %d o %d", final2, saldo2, saldo2-monto)
	}
	if debitados != 1 {
		t.Fatalf("se debito a %d pagadores, se esperaba 1", debitados)
	}

	// Una sola venta y un solo cobro pagado.
	var ventas int
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM qr_payments WHERE charge_id = $1::uuid`, cobro.ID).Scan(&ventas); err != nil {
		t.Fatalf("contar ventas: %v", err)
	}
	if ventas != 1 {
		t.Fatalf("ventas = %d, se esperaba 1", ventas)
	}
}

// Un reintento del mismo POST reproduce la transferencia original en vez de
// duplicarla: es el caso normal cuando la respuesta no llega.
func TestReintentoDelMismoCobroNoDuplica(t *testing.T) {
	svc, pool, payer, owner := setupQR(t)
	ctx := context.Background()

	m := comercioVerificado(t, svc, owner)
	code := rotuloDelComercio(t, svc, owner, m.ID)
	cobro := cobrar(t, svc, owner, code.ID, 50000)

	saldo0 := walletCRC(t, pool, payer)
	primera, err := svc.ScanAndPay(ctx, payer, &qrpayment.ScanQRPaymentRequest{QRData: cobro.QRData, Currency: "CRC"})
	if err != nil {
		t.Fatalf("primer pago: %v", err)
	}
	segunda, err := svc.ScanAndPay(ctx, payer, &qrpayment.ScanQRPaymentRequest{QRData: cobro.QRData, Currency: "CRC"})
	if err != nil {
		t.Fatalf("reintento: %v", err)
	}
	if segunda.ID != primera.ID {
		t.Fatalf("el reintento creo otra venta (%s vs %s)", segunda.ID, primera.ID)
	}
	if got := walletCRC(t, pool, payer); got != saldo0-50000 {
		t.Fatalf("saldo = %d, se esperaba %d: se cobro dos veces", got, saldo0-50000)
	}
}

// ── El codigo permanente se puede pagar muchas veces ────────────────────────

// El punto de reciclar: la misma persona le paga DOS VECES al mismo rotulo, con
// dos nonces distintos, y las dos veces se mueve plata.
//
// Con la llave vieja —el par (QR, pagador)— el segundo pago encontraba la fila
// del primero, CreateTransfer la devolvia sin error y la pantalla decia "pagado"
// sin mover un centimo.
func TestElMismoPagadorPagaDosVecesElRotulo(t *testing.T) {
	svc, pool, payer, owner := setupQR(t)
	ctx := context.Background()

	m := comercioVerificado(t, svc, owner)
	code := rotuloDelComercio(t, svc, owner, m.ID)
	const monto int64 = 30000

	saldo0 := walletCRC(t, pool, payer)
	uno, err := svc.ScanAndPay(ctx, payer, &qrpayment.ScanQRPaymentRequest{
		QRData: code.QRData, Amount: monto, Currency: "CRC", IdempotencyKey: "nonceuno01",
	})
	if err != nil {
		t.Fatalf("primer pago: %v", err)
	}
	dos, err := svc.ScanAndPay(ctx, payer, &qrpayment.ScanQRPaymentRequest{
		QRData: code.QRData, Amount: monto, Currency: "CRC", IdempotencyKey: "noncedos02",
	})
	if err != nil {
		t.Fatalf("segundo pago: %v", err)
	}
	if uno.ID == dos.ID {
		t.Fatal("los dos pagos son la misma venta: el rotulo no se puede reciclar")
	}
	if got, want := walletCRC(t, pool, payer), saldo0-2*monto; got != want {
		t.Fatalf("saldo = %d, se esperaba %d: no se cobraron los dos pagos", got, want)
	}
}

// El mismo nonce con OTRO monto no se devuelve como exito: el nonce lo controla
// quien recibe la mercaderia.
func TestMismoNonceConOtroMontoSeRechaza(t *testing.T) {
	svc, pool, payer, owner := setupQR(t)
	ctx := context.Background()

	m := comercioVerificado(t, svc, owner)
	code := rotuloDelComercio(t, svc, owner, m.ID)

	if _, err := svc.ScanAndPay(ctx, payer, &qrpayment.ScanQRPaymentRequest{
		QRData: code.QRData, Amount: 20000, Currency: "CRC", IdempotencyKey: "repetido01",
	}); err != nil {
		t.Fatalf("primer pago: %v", err)
	}
	saldo1 := walletCRC(t, pool, payer)

	_, err := svc.ScanAndPay(ctx, payer, &qrpayment.ScanQRPaymentRequest{
		QRData: code.QRData, Amount: 90000, Currency: "CRC", IdempotencyKey: "repetido01",
	})
	if err == nil {
		t.Fatal("se acepto el mismo nonce con otro monto")
	}
	if got := walletCRC(t, pool, payer); got != saldo1 {
		t.Fatalf("saldo = %d, se esperaba %d: se movio plata en un pago rechazado", got, saldo1)
	}
}

func TestNonceMalFormadoSeRechaza(t *testing.T) {
	svc, _, payer, owner := setupQR(t)
	ctx := context.Background()

	m := comercioVerificado(t, svc, owner)
	code := rotuloDelComercio(t, svc, owner, m.ID)

	for _, malo := range []string{strings.Repeat("x", 33), "con espacio", "con/barra"} {
		_, err := svc.ScanAndPay(ctx, payer, &qrpayment.ScanQRPaymentRequest{
			QRData: code.QRData, Amount: 1000, Currency: "CRC", IdempotencyKey: malo,
		})
		if !errors.Is(err, qrpayment.ErrNonceInvalido) {
			t.Errorf("nonce %q: error = %v, se esperaba ErrNonceInvalido", malo, err)
		}
	}
}

// ── Cambiar y cancelar el monto ─────────────────────────────────────────────

// Cambiar el monto reemplaza el cobro y deja rastro; el pagador que estaba
// mirando el viejo recibe un rechazo explicito en vez de pagar un numero que no
// vio.
func TestCambiarElMontoReemplazaElCobro(t *testing.T) {
	svc, _, payer, owner := setupQR(t)
	ctx := context.Background()

	m := comercioVerificado(t, svc, owner)
	code := rotuloDelComercio(t, svc, owner, m.ID)
	viejo := cobrar(t, svc, owner, code.ID, 500000)

	nuevo, err := svc.CreateCharge(ctx, owner, &qrpayment.CreateChargeRequest{
		QRCodeID: code.ID, Amount: 750000, Replaces: viejo.ID,
	})
	if err != nil {
		t.Fatalf("cambiar el monto: %v", err)
	}
	if nuevo.QRData == viejo.QRData {
		t.Fatal("el cobro nuevo reuso el payload del viejo")
	}

	reLeido, err := svc.GetCharge(ctx, owner, viejo.ID)
	if err != nil {
		t.Fatalf("releer el cobro viejo: %v", err)
	}
	if reLeido.Status != qrpayment.EstadoCobroReemplazado || reLeido.SupersededBy != nuevo.ID {
		t.Fatalf("el viejo quedo %s / %s", reLeido.Status, reLeido.SupersededBy)
	}

	// Quien estaba mirando el viejo no paga.
	_, err = svc.ScanAndPay(ctx, payer, &qrpayment.ScanQRPaymentRequest{QRData: viejo.QRData, Currency: "CRC"})
	if !errors.Is(err, qrpayment.ErrCobroReemplazado) {
		t.Fatalf("error = %v, se esperaba ErrCobroReemplazado", err)
	}
}

// LA RAMA DEL DOBLE COBRO: cambiar el monto de un cobro que ACABA de pagarse.
// Si aqui se dijera "reemplazado", el cajero pediria el pago otra vez sobre una
// venta que ya entro.
func TestCambiarElMontoDeUnCobroYaPagado(t *testing.T) {
	svc, pool, payer, owner := setupQR(t)
	ctx := context.Background()

	m := comercioVerificado(t, svc, owner)
	code := rotuloDelComercio(t, svc, owner, m.ID)
	cobro := cobrar(t, svc, owner, code.ID, 40000)

	if _, err := svc.ScanAndPay(ctx, payer, &qrpayment.ScanQRPaymentRequest{QRData: cobro.QRData, Currency: "CRC"}); err != nil {
		t.Fatalf("pago: %v", err)
	}

	_, err := svc.CreateCharge(ctx, owner, &qrpayment.CreateChargeRequest{
		QRCodeID: code.ID, Amount: 90000, Replaces: cobro.ID,
	})
	if !errors.Is(err, qrpayment.ErrCobroYaPagado) {
		t.Fatalf("error = %v, se esperaba ErrCobroYaPagado", err)
	}

	// Y NO se creo el cobro nuevo.
	var n int
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM qr_charges WHERE qr_code_id = $1::uuid`, code.ID).Scan(&n); err != nil {
		t.Fatalf("contar cobros: %v", err)
	}
	if n != 1 {
		t.Fatalf("cobros = %d, se esperaba 1: se emitio uno nuevo sobre una venta ya pagada", n)
	}
}

func TestCancelarUnCobroYaPagado(t *testing.T) {
	svc, _, payer, owner := setupQR(t)
	ctx := context.Background()

	m := comercioVerificado(t, svc, owner)
	code := rotuloDelComercio(t, svc, owner, m.ID)
	cobro := cobrar(t, svc, owner, code.ID, 40000)

	if _, err := svc.ScanAndPay(ctx, payer, &qrpayment.ScanQRPaymentRequest{QRData: cobro.QRData, Currency: "CRC"}); err != nil {
		t.Fatalf("pago: %v", err)
	}
	if err := svc.CancelCharge(ctx, owner, cobro.ID); !errors.Is(err, qrpayment.ErrCobroYaPagado) {
		t.Fatalf("error = %v, se esperaba ErrCobroYaPagado", err)
	}
}

func TestCobroCanceladoNoSePaga(t *testing.T) {
	svc, _, payer, owner := setupQR(t)
	ctx := context.Background()

	m := comercioVerificado(t, svc, owner)
	code := rotuloDelComercio(t, svc, owner, m.ID)
	cobro := cobrar(t, svc, owner, code.ID, 40000)

	if err := svc.CancelCharge(ctx, owner, cobro.ID); err != nil {
		t.Fatalf("cancelar: %v", err)
	}
	_, err := svc.ScanAndPay(ctx, payer, &qrpayment.ScanQRPaymentRequest{QRData: cobro.QRData, Currency: "CRC"})
	if !errors.Is(err, qrpayment.ErrCobroCancelado) {
		t.Fatalf("error = %v, se esperaba ErrCobroCancelado", err)
	}
}

// El pagador dice que cobro VIO. Si no es el vigente, no se le cobra.
func TestElCobroQueElPagadorVioTieneQueSerElVigente(t *testing.T) {
	svc, _, payer, owner := setupQR(t)
	ctx := context.Background()

	m := comercioVerificado(t, svc, owner)
	code := rotuloDelComercio(t, svc, owner, m.ID)
	cobro := cobrar(t, svc, owner, code.ID, 40000)

	_, err := svc.ScanAndPay(ctx, payer, &qrpayment.ScanQRPaymentRequest{
		QRData: cobro.QRData, ChargeID: "00000000-0000-0000-0000-000000000999", Currency: "CRC",
	})
	if !errors.Is(err, qrpayment.ErrCobroReemplazado) {
		t.Fatalf("error = %v, se esperaba ErrCobroReemplazado", err)
	}
}

// ── Revocacion ──────────────────────────────────────────────────────────────

func TestUnCodigoRevocadoNoCobra(t *testing.T) {
	svc, _, payer, owner := setupQR(t)
	ctx := context.Background()

	code, err := svc.GetOrCreateMyCode(ctx, owner, "CRC")
	if err != nil {
		t.Fatalf("GetOrCreateMyCode: %v", err)
	}
	if err := svc.RevokeCode(ctx, owner, code.ID); err != nil {
		t.Fatalf("revocar: %v", err)
	}
	_, err = svc.ScanAndPay(ctx, payer, &qrpayment.ScanQRPaymentRequest{
		QRData: code.QRData, Amount: 1000, Currency: "CRC", IdempotencyKey: "tras-revocar",
	})
	if !errors.Is(err, qrpayment.ErrQRRevocado) {
		t.Fatalf("error = %v, se esperaba ErrQRRevocado", err)
	}

	// Y despues de revocar se puede emitir otro: el indice unico solo cuenta los
	// activos.
	otro, err := svc.GetOrCreateMyCode(ctx, owner, "CRC")
	if err != nil {
		t.Fatalf("emitir otro codigo: %v", err)
	}
	if otro.ID == code.ID {
		t.Fatal("se devolvio el codigo revocado")
	}
}

// ── Compatibilidad con la aplicacion vieja ──────────────────────────────────

// Un cliente viejo manda type + amount. El servidor enruta POR EL MONTO: con
// monto emite un cobro y lo devuelve con la forma vieja, sin monto devuelve el
// rotulo. Asi la pantalla de cobro de una aplicacion vieja no muere.
func TestAppViejaConMontoRecibeUnCobro(t *testing.T) {
	svc, _, _, owner := setupQR(t)
	ctx := context.Background()
	m := comercioVerificado(t, svc, owner)

	viejo, err := svc.CreateQRCode(ctx, owner, &qrpayment.CreateQRCodeRequest{
		Type: "merchant_fixed", Amount: 250000, Currency: "CRC", MerchantID: m.ID,
	})
	if err != nil {
		t.Fatalf("CreateQRCode con monto: %v", err)
	}
	if viejo.Amount != 250000 || !viejo.SingleUse || viejo.ExpiresAt == nil {
		t.Fatalf("el DTO viejo perdio el monto o el vencimiento: %+v", viejo)
	}
	if !strings.Contains(viejo.QRData, ":250000:CRC:x") {
		t.Fatalf("el payload del cobro no lleva el monto: %s", viejo.QRData)
	}
}

func TestAppViejaSinMontoRecibeElRotulo(t *testing.T) {
	svc, _, _, owner := setupQR(t)
	ctx := context.Background()
	m := comercioVerificado(t, svc, owner)

	uno, err := svc.CreateQRCode(ctx, owner, &qrpayment.CreateQRCodeRequest{
		Type: "merchant_dynamic", Currency: "CRC", MerchantID: m.ID,
	})
	if err != nil {
		t.Fatalf("CreateQRCode sin monto: %v", err)
	}
	dos, err := svc.CreateQRCode(ctx, owner, &qrpayment.CreateQRCodeRequest{
		Type: "merchant_dynamic", Currency: "CRC", MerchantID: m.ID,
	})
	if err != nil {
		t.Fatalf("CreateQRCode sin monto (2): %v", err)
	}
	if uno.ID != dos.ID {
		t.Fatal("dos toques crearon dos identidades: el codigo no se reciclo")
	}
	if uno.Amount != 0 || uno.SingleUse || uno.ExpiresAt != nil {
		t.Fatalf("el rotulo no deberia tener monto ni vencimiento: %+v", uno)
	}
}

// ── Resolucion ──────────────────────────────────────────────────────────────

// La hoja de pago necesita saber A QUIEN se le paga antes de mostrar un boton.
func TestResolverDiceAQuienSeLePaga(t *testing.T) {
	svc, _, _, owner := setupQR(t)
	ctx := context.Background()
	m := comercioVerificado(t, svc, owner)
	code := rotuloDelComercio(t, svc, owner, m.ID)

	res, err := svc.ResolveQR(ctx, code.QRData)
	if err != nil {
		t.Fatalf("ResolveQR: %v", err)
	}
	if res.Kind != "code" || res.MerchantName != "Soda Tica" || res.Amount != 0 {
		t.Fatalf("resolucion inesperada: %+v", res)
	}

	cobro := cobrar(t, svc, owner, code.ID, 12345)
	res2, err := svc.ResolveQR(ctx, cobro.QRData)
	if err != nil {
		t.Fatalf("ResolveQR del cobro: %v", err)
	}
	if res2.Kind != "charge" || res2.Amount != 12345 || res2.ChargeID != cobro.ID {
		t.Fatalf("resolucion del cobro inesperada: %+v", res2)
	}
}

// ── Codigos viejos que siguen circulando ────────────────────────────────────

// insertarCodigoLegacy escribe a mano una fila como las que quedaron despues de
// la migracion: 'historic', de un solo uso y con monto adentro. Es lo que tiene
// alguien que compartio una solicitud de plata por WhatsApp ayer.
func insertarCodigoLegacy(t *testing.T, pool interface {
	Exec(context.Context, string, ...interface{}) (pgconn.CommandTag, error)
}, creatorID string, monto int64) string {
	t.Helper()
	id := uuid.New().String()
	qrData := "KP:p2p_request:" + id[:8] + ":" + strconv.FormatInt(monto, 10) + ":CRC:" + strings.Repeat("ab", 12)
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO qr_payment_codes (id, creator_id, type, amount, currency, qr_data, single_use, used, status, expires_at)
		 VALUES ($1::uuid, $2::uuid, 'p2p_request', $3, 'CRC', $4, TRUE, FALSE, 'historic', NOW() + INTERVAL '1 day')`,
		id, creatorID, monto, qrData); err != nil {
		t.Fatalf("insertar codigo legacy: %v", err)
	}
	return qrData
}

// Un codigo viejo se sigue pagando: nadie pierde una solicitud que ya compartio.
func TestCodigoLegacySeSiguePagando(t *testing.T) {
	svc, pool, payer, owner := setupQR(t)
	ctx := context.Background()

	qrData := insertarCodigoLegacy(t, pool, owner, 15000)
	saldo0 := walletCRC(t, pool, payer)

	if _, err := svc.ScanAndPay(ctx, payer, &qrpayment.ScanQRPaymentRequest{QRData: qrData, Currency: "CRC"}); err != nil {
		t.Fatalf("pagar un codigo viejo: %v", err)
	}
	if got, want := walletCRC(t, pool, payer), saldo0-15000; got != want {
		t.Fatalf("saldo = %d, se esperaba %d", got, want)
	}
}

// Y un codigo viejo de un solo uso no lo pueden pagar dos personas. El reclamo
// con guarda arregla el doble pago tambien para los que siguen circulando: antes
// se comprobaba `used` arriba, se movia el dinero, y se marcaba usado despues en
// modo best-effort.
func TestCodigoLegacyDeUnSoloUsoNoLoPaganDos(t *testing.T) {
	svc, pool, payer, owner := setupQR(t)
	ctx := context.Background()
	segundo := testutil.SeedTestUser3(t, pool)

	qrData := insertarCodigoLegacy(t, pool, owner, 15000)
	saldo1, saldo2 := walletCRC(t, pool, payer), walletCRC(t, pool, segundo)

	var wg sync.WaitGroup
	errs := make([]error, 2)
	for i, uid := range []string{payer, segundo} {
		wg.Add(1)
		go func(i int, uid string) {
			defer wg.Done()
			_, errs[i] = svc.ScanAndPay(ctx, uid, &qrpayment.ScanQRPaymentRequest{
				QRData: qrData, Currency: "CRC",
			})
		}(i, uid)
	}
	wg.Wait()

	exitos := 0
	for _, err := range errs {
		if err == nil {
			exitos++
		}
	}
	if exitos != 1 {
		t.Fatalf("pagos exitosos = %d, se esperaba 1 (errs=%v)", exitos, errs)
	}
	debitados := 0
	if walletCRC(t, pool, payer) == saldo1-15000 {
		debitados++
	}
	if walletCRC(t, pool, segundo) == saldo2-15000 {
		debitados++
	}
	if debitados != 1 {
		t.Fatalf("se debito a %d pagadores, se esperaba 1", debitados)
	}
}
