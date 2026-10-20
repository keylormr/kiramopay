package qrpayment_test

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/kiramopay/backend/internal/qrpayment"
)

// Lo que encontro la revision adversaria del cierre (PR 292).

// autenticadorQueCuenta es autenticadorDePrueba que ademas cuenta cuantas veces
// se le pidio verificar un codigo: un codigo verificado es un codigo gastado.
type autenticadorQueCuenta struct {
	codigo      string
	verificados *atomic.Int32
}

func (a autenticadorQueCuenta) TOTPEnabled(context.Context, string) (bool, error) { return true, nil }

func (a autenticadorQueCuenta) VerifyTOTP(_ context.Context, _, _, code string) (bool, error) {
	a.verificados.Add(1)
	return code == a.codigo, nil
}

// La otra mitad de la carrera: el pago ya tomo la fila del comercio FOR SHARE y
// esta escribiendo su asiento cuando llega el cierre. El cierre espera; cuando
// el pago confirma, lee el saldo con lo que entro y se rechaza. Con una foto de
// la transaccion tomada antes de esperar (REPEATABLE READ), veria cero y
// cerraria un comercio con plata adentro.
func TestCerrarComercio_UnPagoQueTomoLaFilaPrimeroFrenaElCierre(t *testing.T) {
	svc, pool, payer, owner := setupCierre(t, nil)
	ctx := context.Background()
	m := comercioVerificado(t, svc, owner)
	rotulo := rotuloDelComercio(t, svc, owner, m.ID)
	cobro, err := svc.CreateCharge(ctx, owner, &qrpayment.CreateChargeRequest{QRCodeID: rotulo.ID, Amount: 5000})
	if err != nil {
		t.Fatalf("emitir el cobro: %v", err)
	}

	// Se retiene el cobro: el pago toma la fila del comercio, escribe su asiento
	// y se detiene al reclamarlo, con el FOR SHARE ya tomado.
	reten, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("abrir la retencion: %v", err)
	}
	defer func() { _ = reten.Rollback(ctx) }()
	if _, err := reten.Exec(ctx, `SELECT 1 FROM qr_charges WHERE id = $1 FOR UPDATE`, cobro.ID); err != nil {
		t.Fatalf("retener el cobro: %v", err)
	}

	pago := make(chan error, 1)
	go func() {
		_, err := svc.ScanAndPay(ctx, payer, &qrpayment.ScanQRPaymentRequest{QRData: cobro.QRData, ChargeID: cobro.ID})
		pago <- err
	}()
	esperarSentenciaBloqueada(t, pool, pago, "el pago", "UPDATE qr_charges")

	cierre := make(chan error, 1)
	go func() {
		_, err := svc.CerrarComercioComoAdmin(ctx, m.ID, revisorDePrueba, "carrera inversa", actorDePrueba)
		cierre <- err
	}()
	esperarSentenciaBloqueada(t, pool, cierre, "el cierre", "FROM qr_merchants", "FOR UPDATE")

	if err := reten.Rollback(ctx); err != nil {
		t.Fatalf("soltar el cobro: %v", err)
	}
	select {
	case err := <-pago:
		if err != nil {
			t.Fatalf("el pago que tomo la fila primero: %v", err)
		}
	case <-time.After(15 * time.Second):
		t.Fatal("el pago no termino")
	}
	select {
	case err := <-cierre:
		if !errors.Is(err, qrpayment.ErrComercioConSaldo) {
			t.Fatalf("el cierre que espero al pago: err = %v, se esperaba ErrComercioConSaldo", err)
		}
	case <-time.After(15 * time.Second):
		t.Fatal("el cierre no termino")
	}
	if f := leerCierre(t, pool, m.ID); f.cerradoEn != nil || !f.activo {
		t.Fatalf("se cerro un comercio con saldo: %+v", f)
	}
	if s := saldoDelComercio(t, pool, m.ID, "CRC"); s <= 0 {
		t.Fatalf("el pago no dejo saldo: %d", s)
	}
}

// esperarSentenciaBloqueada espera a que una conexion quede detenida en un
// candado con una sentencia que contenga todos los pedazos. Mirar la sentencia,
// y no cualquier espera de la base, es lo que dice en que candado se freno. Si
// la goroutine termina antes, la prueba falla: no espero donde se esperaba.
func esperarSentenciaBloqueada(t *testing.T, pool *pgxpool.Pool, termino <-chan error, quien string, pedazos ...string) {
	t.Helper()
	consulta := `SELECT COUNT(*) FROM pg_stat_activity
		WHERE datname = current_database() AND pid <> pg_backend_pid() AND wait_event_type = 'Lock'`
	args := make([]any, 0, len(pedazos))
	for i, p := range pedazos {
		consulta += fmt.Sprintf(" AND query LIKE $%d", i+1)
		args = append(args, "%"+p+"%")
	}
	for limite := time.Now().Add(10 * time.Second); time.Now().Before(limite); {
		select {
		case err := <-termino:
			t.Fatalf("%s termino sin esperar en el candado %v (err %v)", quien, pedazos, err)
		default:
		}
		if contar(t, pool, consulta, args...) > 0 {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("%s nunca espero en el candado %v", quien, pedazos)
}

// Emitir un cobro sobre el rotulo de un comercio cerrado dice que cerro, no que
// el codigo se retiro: el cierre retira todos los codigos, y "ese codigo fue
// retirado" no le explica al cajero que el local ya no existe.
func TestCrearCobro_EnUnComercioCerradoDiceQueCerro(t *testing.T) {
	svc, _, _, owner := setupCierre(t, nil)
	ctx := context.Background()
	m := comercioVerificado(t, svc, owner)
	rotulo := rotuloDelComercio(t, svc, owner, m.ID)
	cerrarComoDueno(t, svc, m.ID, owner)

	_, err := svc.CreateCharge(ctx, owner, &qrpayment.CreateChargeRequest{QRCodeID: rotulo.ID, Amount: 5000})
	if !errors.Is(err, qrpayment.ErrComercioCerrado) {
		t.Fatalf("cobrar con el rotulo de un comercio cerrado: err = %v, se esperaba ErrComercioCerrado", err)
	}
}

// Un comercio con saldo se rechaza antes de pedir el segundo factor: el codigo
// del autenticador (o uno de recuperacion, que es de un solo uso) no se gasta en
// un cierre que igual no iba a pasar.
func TestCerrarMiComercio_ConSaldoNoGastaElCodigo(t *testing.T) {
	verificados := &atomic.Int32{}
	tope := nuevoTope()
	svc, _, payer, owner := setupCierre(t, &qrpayment.Options{
		Lockout: tope, MaxIntentosDeCierre: 5,
		TOTP: autenticadorQueCuenta{codigo: "123456", verificados: verificados},
	})
	ctx := context.Background()
	m := comercioVerificado(t, svc, owner)
	pagarAlComercio(t, svc, payer, owner, m.ID, 100000)

	_, err := svc.CerrarMiComercio(ctx, m.ID, owner,
		&qrpayment.CerrarComercioRequest{Password: claveDelDueno, TOTPCode: "123456"}, actorDePrueba)
	if !errors.Is(err, qrpayment.ErrComercioConSaldo) {
		t.Fatalf("err = %v, se esperaba ErrComercioConSaldo", err)
	}
	if n := verificados.Load(); n != 0 {
		t.Fatalf("se verifico el codigo %d veces en un cierre que se rechazo por saldo", n)
	}
	if n := tope.contadores(); n != 0 {
		t.Fatalf("un cierre rechazado por saldo conto un intento de reautenticacion (%d contadores)", n)
	}
}

// Pedir el codigo del autenticador no gasta un intento: la pantalla no sabe si
// hace falta hasta que el servidor se lo dice.
func TestCerrarMiComercio_PedirElCodigoNoGastaUnIntento(t *testing.T) {
	tope := nuevoTope()
	svc, _, _, owner := setupCierre(t, &qrpayment.Options{
		Lockout: tope, MaxIntentosDeCierre: 5, TOTP: autenticadorDePrueba{codigo: "123456"},
	})
	m := comercioVerificado(t, svc, owner)

	_, err := svc.CerrarMiComercio(context.Background(), m.ID, owner,
		&qrpayment.CerrarComercioRequest{Password: claveDelDueno}, actorDePrueba)
	if !errors.Is(err, qrpayment.ErrTOTPRequerido) {
		t.Fatalf("err = %v, se esperaba ErrTOTPRequerido", err)
	}
	if n := tope.contadores(); n != 0 {
		t.Fatalf("pedir el codigo conto un intento (%d contadores)", n)
	}
}

// El rastro guarda el identificador canonico del comercio, como lo guarda el
// cierre del administrador: el id que llega en la ruta puede venir en
// mayusculas o con llaves, y una busqueda por el UUID no lo encontraria.
func TestCerrarComercio_PorHTTP_ElRastroLlevaElIdCanonico(t *testing.T) {
	svc, pool, _, owner := setupCierre(t, nil)
	h := qrpayment.NewHandler(svc)
	m := comercioVerificado(t, svc, owner)
	enMayusculas := strings.ToUpper(m.ID)

	rec := httptest.NewRecorder()
	h.CloseMerchant(rec, peticion(http.MethodPost, "/api/v1/qr/merchants/"+enMayusculas+"/close",
		`{"password":"`+claveDelDueno+`"}`, owner, enMayusculas))
	if rec.Code != http.StatusOK {
		t.Fatalf("cerrar con el id en mayusculas: %d %s", rec.Code, rec.Body.String())
	}
	if n := contar(t, pool, `SELECT COUNT(*) FROM audit_logs WHERE action = 'merchant_closed' AND resource_id = $1`, m.ID); n != 1 {
		t.Fatalf("filas de auditoria con el id canonico = %d, se esperaba 1", n)
	}
}

// El motivo del administrador tiene tope en el servidor, no solo en la
// pantalla: es texto que queda para siempre en la fila y en el rastro.
func TestCerrarComercioComoAdmin_MotivoConTope(t *testing.T) {
	svc, pool, payer, owner := setupCierre(t, nil)
	h := qrpayment.NewHandler(svc)
	m := comercioVerificado(t, svc, owner)

	largo := strings.Repeat("a", 501)
	rec := httptest.NewRecorder()
	h.AdminCloseMerchant(rec, peticion(http.MethodPost, "/api/v1/admin/merchants/"+m.ID+"/close",
		`{"reason":"`+largo+`"}`, payer, m.ID))
	if rec.Code != http.StatusBadRequest || codigoDeError(t, rec) != "CLOSURE_REASON_TOO_LONG" {
		t.Fatalf("motivo de 501 caracteres: %d %s", rec.Code, rec.Body.String())
	}
	if f := leerCierre(t, pool, m.ID); f.cerradoEn != nil {
		t.Fatalf("un motivo demasiado largo cerro el comercio: %+v", f)
	}

	justo := strings.Repeat("ñ", 500)
	rec = httptest.NewRecorder()
	h.AdminCloseMerchant(rec, peticion(http.MethodPost, "/api/v1/admin/merchants/"+m.ID+"/close",
		`{"reason":"`+justo+`"}`, payer, m.ID))
	if rec.Code != http.StatusOK {
		t.Fatalf("motivo de 500 caracteres: %d %s", rec.Code, rec.Body.String())
	}
}
