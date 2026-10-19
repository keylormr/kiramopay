package qrpayment_test

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/kiramopay/backend/internal/ledger"
	"github.com/kiramopay/backend/internal/qrpayment"
	"github.com/kiramopay/backend/internal/testutil"
	"github.com/kiramopay/backend/internal/transaction"
	"github.com/kiramopay/backend/internal/user"
	"github.com/kiramopay/backend/internal/wallet"
	"github.com/kiramopay/backend/pkg/hash"
)

// El cierre de un comercio. Pedido del dueno del 2026-10-18: todo borrado es
// logico. Un comercio no se borra nunca: la fila se marca (cuando, quien y por
// que), deja de cobrar, sale de las listas del dueno y del equipo, y el rastro
// queda en audit_logs. La Ley 7786 obliga a conservar las operaciones y la
// identidad del comercio por cinco anos.

const claveDelDueno = "Dueno-Del-Comercio-1"

var actorDePrueba = qrpayment.ActorContext{IPAddress: "127.0.0.1", UserAgent: "prueba"}

// topeDePrueba cuenta los intentos en memoria, como el Redis de produccion.
type topeDePrueba struct {
	mu sync.Mutex
	n  map[string]int64
}

func nuevoTope() *topeDePrueba { return &topeDePrueba{n: map[string]int64{}} }

func (t *topeDePrueba) IncrLockout(k string) int64 {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.n[k]++
	return t.n[k]
}

func (t *topeDePrueba) ResetLockout(k string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	delete(t.n, k)
}

func (t *topeDePrueba) GetLockout(k string) int64 {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.n[k]
}

func (t *topeDePrueba) vaciar() {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.n = map[string]int64{}
}

func (t *topeDePrueba) contadores() int {
	t.mu.Lock()
	defer t.mu.Unlock()
	return len(t.n)
}

// autenticadorDePrueba es una persona con el segundo factor encendido, que
// acepta un solo codigo.
type autenticadorDePrueba struct{ codigo string }

func (a autenticadorDePrueba) TOTPEnabled(context.Context, string) (bool, error) { return true, nil }

func (a autenticadorDePrueba) VerifyTOTP(_ context.Context, _, _, code string) (bool, error) {
	return code == a.codigo, nil
}

func setupCierre(t *testing.T, opts *qrpayment.Options) (*qrpayment.Service, *pgxpool.Pool, string, string) {
	t.Helper()
	pool := testutil.TestDB(t)
	l := ledger.NewEngine(pool, slog.New(slog.NewJSONHandler(os.Stdout, nil)))
	txSvc := transaction.NewService(transaction.NewRepository(pool), wallet.NewRepository(pool), l, nil)
	svc := qrpayment.NewService(qrpayment.NewRepository(pool), txSvc, user.NewRepository(pool), opts)
	pinHash, _ := hash.HashPin("Kiramopay2024!")
	payer := testutil.SeedTestUser(t, pool, "702650930", pinHash)
	owner := testutil.SeedTestUser2(t, pool)
	fijarContrasena(t, pool, owner, claveDelDueno)
	return svc, pool, payer, owner
}

func fijarContrasena(t *testing.T, pool *pgxpool.Pool, userID, clave string) {
	t.Helper()
	h, err := hash.HashPin(clave)
	if err != nil {
		t.Fatalf("hash de la contrasena: %v", err)
	}
	if _, err := pool.Exec(context.Background(),
		`UPDATE users SET password_hash = $2 WHERE id = $1::uuid`, userID, h); err != nil {
		t.Fatalf("fijar la contrasena: %v", err)
	}
}

// saldoDelComercio lee el saldo del comercio del diario, sin pasar por el
// servicio: despues del cierre el servicio ya no se lo muestra a nadie.
func saldoDelComercio(t *testing.T, pool *pgxpool.Pool, merchantID, moneda string) int64 {
	t.Helper()
	var saldo int64
	if err := pool.QueryRow(context.Background(), `
		SELECT COALESCE(SUM(CASE WHEN je.direction = 'credit' THEN je.amount_minor ELSE -je.amount_minor END), 0)
		  FROM journal_entries je
		  JOIN ledger_accounts la ON la.id = je.account_id
		 WHERE la.merchant_id = $1::uuid AND la.currency = $2 AND la.type = 'merchant_wallet'`,
		merchantID, moneda).Scan(&saldo); err != nil {
		t.Fatalf("leer el saldo del comercio: %v", err)
	}
	return saldo
}

type filaDelCierre struct {
	activo     bool
	cerradoEn  *time.Time
	cerradoPor string
	motivo     string
}

func leerCierre(t *testing.T, pool *pgxpool.Pool, merchantID string) filaDelCierre {
	t.Helper()
	var f filaDelCierre
	if err := pool.QueryRow(context.Background(), `
		SELECT COALESCE(active, TRUE), closed_at, COALESCE(closed_by::text, ''), COALESCE(closure_reason, '')
		  FROM qr_merchants WHERE id = $1::uuid`, merchantID,
	).Scan(&f.activo, &f.cerradoEn, &f.cerradoPor, &f.motivo); err != nil {
		t.Fatalf("leer el comercio %s: %v", merchantID, err)
	}
	return f
}

func contar(t *testing.T, pool *pgxpool.Pool, sql string, args ...any) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(), sql, args...).Scan(&n); err != nil {
		t.Fatalf("contar (%s): %v", sql, err)
	}
	return n
}

func cerrarComoDueno(t *testing.T, svc *qrpayment.Service, merchantID, owner string) *qrpayment.Merchant {
	t.Helper()
	m, err := svc.CerrarMiComercio(context.Background(), merchantID, owner,
		&qrpayment.CerrarComercioRequest{Password: claveDelDueno}, actorDePrueba)
	if err != nil {
		t.Fatalf("cerrar el comercio: %v", err)
	}
	return m
}

// ── El cierre del dueno ─────────────────────────────────────────────────────

// Cerrar marca la fila y no borra nada: el comercio queda con su identidad, su
// cajero queda revocado con su fila, el rotulo deja de cobrar, y el dueno sigue
// viendo sus otros comercios. El rastro se escribe en la misma transaccion.
func TestCerrarMiComercio_MarcaTodoYNoBorraNada(t *testing.T) {
	svc, pool, _, owner := setupCierre(t, nil)
	ctx := context.Background()
	m := comercioVerificado(t, svc, owner)
	otro := registrarComercio(t, svc, owner, "Otro Negocio")
	rotulo := rotuloDelComercio(t, svc, owner, m.ID)
	employee := seedEmployee(t, pool, "505550555")
	if _, err := svc.AddStaff(ctx, m.ID, owner, &qrpayment.AddStaffRequest{Cedula: "505550555", Role: "cashier"}); err != nil {
		t.Fatalf("sumar al cajero: %v", err)
	}

	cerrado := cerrarComoDueno(t, svc, m.ID, owner)
	if cerrado.ClosedAt == nil || cerrado.Active || cerrado.ClosedBy != owner ||
		cerrado.ClosureReason != qrpayment.MotivoCierrePropio {
		t.Fatalf("respuesta del cierre: %+v", cerrado)
	}

	if n := contar(t, pool, `SELECT COUNT(*) FROM qr_merchants WHERE id = $1::uuid`, m.ID); n != 1 {
		t.Fatalf("el comercio cerrado tiene que seguir en la base: %d filas", n)
	}
	f := leerCierre(t, pool, m.ID)
	if f.activo || f.cerradoEn == nil || f.cerradoPor != owner || f.motivo != qrpayment.MotivoCierrePropio {
		t.Fatalf("fila del comercio despues del cierre: %+v", f)
	}

	// Sale de la lista del dueno; el otro comercio de la misma persona sigue.
	ms, err := svc.GetMerchants(ctx, owner)
	if err != nil || len(ms) != 1 || ms[0].ID != otro.ID {
		t.Fatalf("lista del dueno = %+v (err %v), se esperaba solo %s", ms, err, otro.ID)
	}

	// El cajero queda revocado, con su fila, y deja de verlo.
	var estado string
	var revocado *time.Time
	if err := pool.QueryRow(ctx,
		`SELECT status, revoked_at FROM merchant_staff WHERE merchant_id = $1::uuid AND user_id = $2::uuid`,
		m.ID, employee).Scan(&estado, &revocado); err != nil {
		t.Fatalf("la fila del cajero tiene que quedar: %v", err)
	}
	if estado != "revoked" || revocado == nil {
		t.Fatalf("cajero despues del cierre: status=%s revoked_at=%v", estado, revocado)
	}
	if ms, err := svc.GetMerchants(ctx, employee); err != nil || len(ms) != 0 {
		t.Fatalf("lista del cajero = %+v (err %v), se esperaba vacia", ms, err)
	}

	// El rotulo deja de cobrar y no queda ningun codigo vivo del comercio.
	var estadoDelRotulo string
	if err := pool.QueryRow(ctx, `SELECT status FROM qr_payment_codes WHERE id = $1::uuid`, rotulo.ID).Scan(&estadoDelRotulo); err != nil {
		t.Fatalf("leer el rotulo: %v", err)
	}
	if estadoDelRotulo != qrpayment.EstadoCodigoRevocado {
		t.Fatalf("rotulo despues del cierre: %s", estadoDelRotulo)
	}
	if n := contar(t, pool,
		`SELECT COUNT(*) FROM qr_payment_codes WHERE merchant_id = $1::uuid AND status = 'active'`, m.ID); n != 0 {
		t.Fatalf("quedaron %d codigos vivos del comercio cerrado", n)
	}

	// El rastro: una fila, del dueno, sin esperar a ningun escritor de fondo.
	if n := contar(t, pool, `SELECT COUNT(*) FROM audit_logs WHERE action = 'merchant_closed'`); n != 1 {
		t.Fatalf("filas de auditoria del cierre: %d, se esperaba 1", n)
	}
	var actor, tipo, recurso, riesgo, motivo, cajeros, codigos string
	if err := pool.QueryRow(ctx, `
		SELECT COALESCE(user_id::text, ''), COALESCE(resource_type, ''), COALESCE(resource_id, ''),
		       COALESCE(risk_level, ''), COALESCE(details->>'reason', ''),
		       COALESCE(details->>'staff_revoked', ''), COALESCE(details->>'codes_revoked', '')
		  FROM audit_logs WHERE action = 'merchant_closed'`,
	).Scan(&actor, &tipo, &recurso, &riesgo, &motivo, &cajeros, &codigos); err != nil {
		t.Fatalf("leer la auditoria: %v", err)
	}
	if actor != owner || tipo != "merchant" || recurso != m.ID || riesgo != "high" ||
		motivo != qrpayment.MotivoCierrePropio || cajeros != "1" || codigos != "1" {
		t.Fatalf("auditoria: actor=%s tipo=%s recurso=%s riesgo=%s motivo=%s cajeros=%s codigos=%s",
			actor, tipo, recurso, riesgo, motivo, cajeros, codigos)
	}
}

// La contrasena se confirma, con tope: sin el, una sesion robada podria probar
// contrasenas sin limite contra esta ruta. Pasado el tope no se mira la
// contrasena, ni siquiera la correcta.
func TestCerrarMiComercio_PideLaContrasenaYTieneTope(t *testing.T) {
	tope := nuevoTope()
	svc, pool, _, owner := setupCierre(t, &qrpayment.Options{Lockout: tope, MaxIntentosDeCierre: 2})
	ctx := context.Background()
	m := comercioVerificado(t, svc, owner)

	for _, clave := range []string{"", "otra-clave-cualquiera"} {
		_, err := svc.CerrarMiComercio(ctx, m.ID, owner, &qrpayment.CerrarComercioRequest{Password: clave}, actorDePrueba)
		if !errors.Is(err, qrpayment.ErrContrasenaIncorrecta) {
			t.Fatalf("contrasena %q: err = %v, se esperaba ErrContrasenaIncorrecta", clave, err)
		}
	}
	_, err := svc.CerrarMiComercio(ctx, m.ID, owner, &qrpayment.CerrarComercioRequest{Password: claveDelDueno}, actorDePrueba)
	if !errors.Is(err, qrpayment.ErrCierreEnPausa) {
		t.Fatalf("tercer intento con el tope de 2: err = %v, se esperaba ErrCierreEnPausa", err)
	}
	if f := leerCierre(t, pool, m.ID); f.cerradoEn != nil || !f.activo {
		t.Fatalf("un intento rechazado cerro el comercio: %+v", f)
	}

	// Vencida la pausa (en Redis el contador expira), la correcta cierra y el
	// contador se limpia.
	tope.vaciar()
	cerrarComoDueno(t, svc, m.ID, owner)
	if n := tope.contadores(); n != 0 {
		t.Fatalf("despues de acertar quedaron %d contadores", n)
	}
}

// Con el segundo factor encendido, la contrasena sola no alcanza.
func TestCerrarMiComercio_ConSegundoFactor(t *testing.T) {
	svc, pool, _, owner := setupCierre(t, &qrpayment.Options{TOTP: autenticadorDePrueba{codigo: "123456"}})
	ctx := context.Background()
	m := comercioVerificado(t, svc, owner)

	casos := []struct {
		req  qrpayment.CerrarComercioRequest
		want error
	}{
		{qrpayment.CerrarComercioRequest{Password: claveDelDueno}, qrpayment.ErrTOTPRequerido},
		{qrpayment.CerrarComercioRequest{Password: claveDelDueno, TOTPCode: "000000"}, qrpayment.ErrTOTPInvalido},
		{qrpayment.CerrarComercioRequest{Password: "otra-clave", TOTPCode: "123456"}, qrpayment.ErrContrasenaIncorrecta},
	}
	for _, c := range casos {
		req := c.req
		if _, err := svc.CerrarMiComercio(ctx, m.ID, owner, &req, actorDePrueba); !errors.Is(err, c.want) {
			t.Fatalf("%+v: err = %v, se esperaba %v", c.req, err, c.want)
		}
	}
	if f := leerCierre(t, pool, m.ID); f.cerradoEn != nil {
		t.Fatalf("un intento rechazado cerro el comercio: %+v", f)
	}
	if _, err := svc.CerrarMiComercio(ctx, m.ID, owner,
		&qrpayment.CerrarComercioRequest{Password: claveDelDueno, TOTPCode: "123456"}, actorDePrueba); err != nil {
		t.Fatalf("con contrasena y codigo: %v", err)
	}
}

// Una cuenta que entra sin contrasena no tiene con que reautenticarse.
func TestCerrarMiComercio_CuentaDeDemostracion(t *testing.T) {
	svc, pool, _, _ := setupCierre(t, nil)
	ctx := context.Background()
	demo := testutil.SeedTestUser3(t, pool)
	if _, err := pool.Exec(ctx, `UPDATE users SET demo_login = TRUE WHERE id = $1::uuid`, demo); err != nil {
		t.Fatalf("marcar la cuenta de demostracion: %v", err)
	}
	m := registrarComercio(t, svc, demo, "Soda Demo")

	_, err := svc.CerrarMiComercio(ctx, m.ID, demo, &qrpayment.CerrarComercioRequest{Password: "lo-que-sea"}, actorDePrueba)
	if !errors.Is(err, user.ErrCuentaDeDemostracion) {
		t.Fatalf("err = %v, se esperaba ErrCuentaDeDemostracion", err)
	}
	if f := leerCierre(t, pool, m.ID); f.cerradoEn != nil {
		t.Fatalf("la cuenta de demostracion cerro su comercio: %+v", f)
	}
}

// Solo el dueno cierra. Ajeno, del equipo o inexistente es lo mismo para quien
// pregunta: no se le confirma que el comercio existe.
func TestCerrarMiComercio_SoloElDueno(t *testing.T) {
	svc, pool, payer, owner := setupCierre(t, nil)
	ctx := context.Background()
	m := comercioVerificado(t, svc, owner)
	employee := seedEmployee(t, pool, "606660666")
	fijarContrasena(t, pool, employee, "Clave-Del-Gerente-1")
	if _, err := svc.AddStaff(ctx, m.ID, owner, &qrpayment.AddStaffRequest{Cedula: "606660666", Role: "manager"}); err != nil {
		t.Fatalf("sumar al gerente: %v", err)
	}

	casos := []struct {
		quien, comercio, clave string
	}{
		{payer, m.ID, "Kiramopay2024!"},
		{employee, m.ID, "Clave-Del-Gerente-1"},
		{owner, uuid.NewString(), claveDelDueno},
	}
	for _, c := range casos {
		_, err := svc.CerrarMiComercio(ctx, c.comercio, c.quien, &qrpayment.CerrarComercioRequest{Password: c.clave}, actorDePrueba)
		if !errors.Is(err, qrpayment.ErrComercioNoEncontrado) {
			t.Fatalf("%s cerrando %s: err = %v, se esperaba ErrComercioNoEncontrado", c.quien, c.comercio, err)
		}
	}
	if f := leerCierre(t, pool, m.ID); f.cerradoEn != nil {
		t.Fatalf("alguien que no es el dueno cerro el comercio: %+v", f)
	}
}

// Con plata adentro no se cierra: el dinero del negocio no puede quedar en un
// comercio al que nadie puede entrar. Se le dice cuanto queda y en que moneda;
// retirado todo, cierra.
func TestCerrarComercio_ConSaldoSeRechaza(t *testing.T) {
	svc, pool, payer, owner := setupCierre(t, nil)
	ctx := context.Background()
	m := comercioVerificado(t, svc, owner)
	pagarAlComercio(t, svc, payer, owner, m.ID, 100000)
	saldo := saldoDelComercio(t, pool, m.ID, "CRC")
	if saldo <= 0 {
		t.Fatalf("el pago no dejo saldo en el comercio: %d", saldo)
	}

	_, err := svc.CerrarMiComercio(ctx, m.ID, owner, &qrpayment.CerrarComercioRequest{Password: claveDelDueno}, actorDePrueba)
	if !errors.Is(err, qrpayment.ErrComercioConSaldo) {
		t.Fatalf("err = %v, se esperaba ErrComercioConSaldo", err)
	}
	var detalle *qrpayment.ComercioConSaldoError
	if !errors.As(err, &detalle) || len(detalle.Saldos) != 1 ||
		detalle.Saldos[0].Currency != "CRC" || detalle.Saldos[0].Amount != saldo {
		t.Fatalf("detalle del rechazo = %+v, se esperaba CRC %d", detalle, saldo)
	}
	if f := leerCierre(t, pool, m.ID); f.cerradoEn != nil || !f.activo {
		t.Fatalf("el rechazo cerro el comercio: %+v", f)
	}
	if ms, _ := svc.GetMerchants(ctx, owner); len(ms) != 1 {
		t.Fatalf("el comercio rechazado tiene que seguir en la lista: %+v", ms)
	}
	if n := contar(t, pool, `SELECT COUNT(*) FROM audit_logs WHERE action = 'merchant_closed'`); n != 0 {
		t.Fatalf("un cierre rechazado dejo %d filas de auditoria de cierre", n)
	}

	if _, err := svc.WithdrawToOwner(ctx, m.ID, owner, "CRC", saldo, "retiro-antes-de-cerrar"); err != nil {
		t.Fatalf("retirar el saldo: %v", err)
	}
	cerrarComoDueno(t, svc, m.ID, owner)
}

// Un cobro que alguien puede estar por pagar frena el cierre. Uno vencido no:
// ya no se puede pagar, y el cierre lo deja vencido.
func TestCerrarComercio_ConCobroPendienteSeRechaza(t *testing.T) {
	svc, pool, _, owner := setupCierre(t, nil)
	ctx := context.Background()
	m := comercioVerificado(t, svc, owner)
	rotulo := rotuloDelComercio(t, svc, owner, m.ID)
	cobro, err := svc.CreateCharge(ctx, owner, &qrpayment.CreateChargeRequest{QRCodeID: rotulo.ID, Amount: 5000})
	if err != nil {
		t.Fatalf("emitir el cobro: %v", err)
	}

	_, err = svc.CerrarMiComercio(ctx, m.ID, owner, &qrpayment.CerrarComercioRequest{Password: claveDelDueno}, actorDePrueba)
	if !errors.Is(err, qrpayment.ErrComercioConCobrosPendientes) {
		t.Fatalf("err = %v, se esperaba ErrComercioConCobrosPendientes", err)
	}
	var detalle *qrpayment.ComercioConCobrosError
	if !errors.As(err, &detalle) || detalle.Pendientes != 1 {
		t.Fatalf("detalle del rechazo = %+v, se esperaba 1 pendiente", detalle)
	}
	if f := leerCierre(t, pool, m.ID); f.cerradoEn != nil {
		t.Fatalf("el rechazo cerro el comercio: %+v", f)
	}

	if _, err := pool.Exec(ctx,
		`UPDATE qr_charges SET expires_at = NOW() - INTERVAL '1 minute' WHERE id = $1::uuid`, cobro.ID); err != nil {
		t.Fatalf("vencer el cobro: %v", err)
	}
	cerrarComoDueno(t, svc, m.ID, owner)
	var estado string
	if err := pool.QueryRow(ctx, `SELECT status FROM qr_charges WHERE id = $1::uuid`, cobro.ID).Scan(&estado); err != nil {
		t.Fatalf("leer el cobro: %v", err)
	}
	if estado != qrpayment.EstadoCobroVencido {
		t.Fatalf("el cobro vencido de un comercio cerrado quedo %s", estado)
	}
}

// Cerrar dos veces no vuelve a marcar nada: el cierre es uno solo.
func TestCerrarComercio_DosVeces(t *testing.T) {
	svc, pool, _, owner := setupCierre(t, nil)
	ctx := context.Background()
	m := comercioVerificado(t, svc, owner)
	primero := cerrarComoDueno(t, svc, m.ID, owner)

	_, err := svc.CerrarMiComercio(ctx, m.ID, owner, &qrpayment.CerrarComercioRequest{Password: claveDelDueno}, actorDePrueba)
	if !errors.Is(err, qrpayment.ErrComercioCerrado) {
		t.Fatalf("dueno, segunda vez: err = %v, se esperaba ErrComercioCerrado", err)
	}
	_, err = svc.CerrarComercioComoAdmin(ctx, m.ID, owner, "otra vez", actorDePrueba)
	if !errors.Is(err, qrpayment.ErrComercioCerrado) {
		t.Fatalf("administrador, segunda vez: err = %v, se esperaba ErrComercioCerrado", err)
	}
	f := leerCierre(t, pool, m.ID)
	if f.cerradoEn == nil || !f.cerradoEn.Equal(*primero.ClosedAt) || f.motivo != qrpayment.MotivoCierrePropio {
		t.Fatalf("el segundo cierre piso al primero: %+v", f)
	}
	if n := contar(t, pool, `SELECT COUNT(*) FROM audit_logs WHERE action IN ('merchant_closed', 'admin_merchant_closed')`); n != 1 {
		t.Fatalf("filas de auditoria: %d, se esperaba 1", n)
	}
}

// ── Lo que un comercio cerrado ya no hace ───────────────────────────────────

// Pagarle o resolver su codigo da un error propio, no "no existe" ni un 500. El
// dueno tampoco puede volver a pedir el rotulo, retirar, editarlo ni sumar
// gente, y un administrador no lo puede volver a aprobar.
func TestComercioCerrado_NoCobraNiSeAdministra(t *testing.T) {
	svc, pool, payer, owner := setupCierre(t, nil)
	ctx := context.Background()
	m := comercioVerificado(t, svc, owner)
	rotulo := rotuloDelComercio(t, svc, owner, m.ID)
	seedEmployee(t, pool, "707770777")
	cerrarComoDueno(t, svc, m.ID, owner)
	antes := walletCRC(t, pool, payer)

	_, err := svc.ScanAndPay(ctx, payer, &qrpayment.ScanQRPaymentRequest{
		QRData: rotulo.QRData, Amount: 5000, Currency: "CRC", IdempotencyKey: "pago-a-un-cerrado-1",
	})
	if !errors.Is(err, qrpayment.ErrComercioCerrado) {
		t.Fatalf("pagar el rotulo de un comercio cerrado: err = %v, se esperaba ErrComercioCerrado", err)
	}
	if _, err := svc.ResolveQR(ctx, rotulo.QRData); !errors.Is(err, qrpayment.ErrComercioCerrado) {
		t.Fatalf("resolver el rotulo de un comercio cerrado: err = %v, se esperaba ErrComercioCerrado", err)
	}

	if _, err := svc.GetOrCreateMerchantCode(ctx, owner, m.ID, "", "CRC"); !errors.Is(err, qrpayment.ErrComercioCerrado) {
		t.Fatalf("pedir el rotulo de un comercio cerrado: err = %v, se esperaba ErrComercioCerrado", err)
	}
	if n := contar(t, pool,
		`SELECT COUNT(*) FROM qr_payment_codes WHERE merchant_id = $1::uuid AND status = 'active'`, m.ID); n != 0 {
		t.Fatalf("pedir el rotulo de un comercio cerrado creo %d codigos vivos", n)
	}
	if _, err := svc.WithdrawToOwner(ctx, m.ID, owner, "CRC", 100, "retiro-de-un-cerrado"); !errors.Is(err, qrpayment.ErrComercioCerrado) {
		t.Fatalf("retirar de un comercio cerrado: err = %v, se esperaba ErrComercioCerrado", err)
	}
	if _, err := svc.UpdateMerchant(ctx, m.ID, owner, &qrpayment.RegisterMerchantRequest{
		Name: "Otro nombre", Cedula: "3-101-999", CedulaType: "juridica", LegalName: "Otra SA",
	}); !errors.Is(err, qrpayment.ErrComercioCerrado) {
		t.Fatalf("editar un comercio cerrado: err = %v, se esperaba ErrComercioCerrado", err)
	}
	if _, err := svc.ApproveMerchant(ctx, m.ID, owner); !errors.Is(err, qrpayment.ErrComercioCerrado) {
		t.Fatalf("aprobar un comercio cerrado: err = %v, se esperaba ErrComercioCerrado", err)
	}
	if _, err := svc.RejectMerchant(ctx, m.ID, owner, "motivo"); !errors.Is(err, qrpayment.ErrComercioCerrado) {
		t.Fatalf("rechazar un comercio cerrado: err = %v, se esperaba ErrComercioCerrado", err)
	}
	if _, err := svc.AddStaff(ctx, m.ID, owner, &qrpayment.AddStaffRequest{Cedula: "707770777", Role: "cashier"}); err == nil {
		t.Fatal("se sumo un cajero a un comercio cerrado")
	}
	if n := contar(t, pool, `SELECT COUNT(*) FROM merchant_staff WHERE merchant_id = $1::uuid`, m.ID); n != 0 {
		t.Fatalf("un comercio cerrado gano %d filas de equipo", n)
	}
	f := leerCierre(t, pool, m.ID)
	if f.cerradoEn == nil || f.activo {
		t.Fatalf("algo reabrio el comercio: %+v", f)
	}

	// Un rotulo vivo de un comercio cerrado (el que alguien pidio justo mientras
	// se cerraba) tampoco cobra: lo que manda es el comercio, no el codigo.
	var vivo string
	if err := pool.QueryRow(ctx, `
		INSERT INTO qr_payment_codes (creator_id, type, amount, currency, merchant_id, qr_data, single_use, used, status)
		VALUES ($1::uuid, 'merchant_dynamic', 0, 'CRC', $2::uuid,
		        'KP:merchant_dynamic:0000cafe:0:CRC:i' || md5(random()::text), FALSE, FALSE, 'active')
		RETURNING qr_data`, owner, m.ID).Scan(&vivo); err != nil {
		t.Fatalf("sembrar un rotulo vivo: %v", err)
	}
	if _, err := svc.ScanAndPay(ctx, payer, &qrpayment.ScanQRPaymentRequest{
		QRData: vivo, Amount: 5000, Currency: "CRC", IdempotencyKey: "pago-a-un-cerrado-2",
	}); !errors.Is(err, qrpayment.ErrComercioCerrado) {
		t.Fatalf("pagar un rotulo vivo de un comercio cerrado: err = %v, se esperaba ErrComercioCerrado", err)
	}
	if _, err := svc.ResolveQR(ctx, vivo); !errors.Is(err, qrpayment.ErrComercioCerrado) {
		t.Fatalf("resolver un rotulo vivo de un comercio cerrado: err = %v, se esperaba ErrComercioCerrado", err)
	}

	if got := walletCRC(t, pool, payer); got != antes {
		t.Fatalf("la billetera del pagador cambio: %d -> %d", antes, got)
	}
	if s := saldoDelComercio(t, pool, m.ID, "CRC"); s != 0 {
		t.Fatalf("el comercio cerrado recibio %d", s)
	}
}

// La carrera: un pago que ya esta escribiendo su asiento mientras el comercio
// se cierra. El cierre toma la fila del comercio; el pago la pide dentro de la
// transaccion del asiento, espera, y al ver el cierre se deshace entero. Sin
// eso, el cierre veia saldo cero, cerraba, y el pago entraba despues a un
// comercio al que ya nadie podia entrar a retirarlo.
//
// El comercio ya vendio y retiro todo: su cuenta del libro existe, con saldo
// cero, que es el caso de un local de verdad. Sin cuenta, el pago se frenaba
// antes, al crearla (la FK a qr_merchants), y la prueba pasaba aunque el
// asiento no pidiera la fila del comercio.
func TestCerrarComercio_UnPagoEnVueloNoEntraAUnComercioQueSeCierra(t *testing.T) {
	svc, pool, payer, owner := setupCierre(t, nil)
	ctx := context.Background()
	m := comercioVerificado(t, svc, owner)
	rotulo := rotuloDelComercio(t, svc, owner, m.ID)
	pagarAlComercio(t, svc, payer, owner, m.ID, 100000)
	if _, err := svc.WithdrawToOwner(ctx, m.ID, owner, "CRC", saldoDelComercio(t, pool, m.ID, "CRC"), "vaciar-antes-de-la-carrera"); err != nil {
		t.Fatalf("vaciar el comercio: %v", err)
	}
	if s := saldoDelComercio(t, pool, m.ID, "CRC"); s != 0 {
		t.Fatalf("el comercio no quedo en cero: %d", s)
	}
	antes := walletCRC(t, pool, payer)
	ventasAntes := contar(t, pool, `SELECT COUNT(*) FROM qr_payments WHERE merchant_id = $1::uuid`, m.ID)

	cierre, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("abrir el cierre: %v", err)
	}
	defer func() { _ = cierre.Rollback(ctx) }()
	if _, err := cierre.Exec(ctx, `SELECT 1 FROM qr_merchants WHERE id = $1::uuid FOR UPDATE`, m.ID); err != nil {
		t.Fatalf("tomar la fila del comercio: %v", err)
	}

	listo := make(chan error, 1)
	go func() {
		_, err := svc.ScanAndPay(ctx, payer, &qrpayment.ScanQRPaymentRequest{
			QRData: rotulo.QRData, Amount: 5000, Currency: "CRC", IdempotencyKey: "carrera-del-cierre-1",
		})
		listo <- err
	}()

	esperarSentenciaBloqueada(t, pool, listo, "el pago", "FROM qr_merchants", "FOR SHARE")

	if _, err := cierre.Exec(ctx, `
		UPDATE qr_merchants
		   SET active = FALSE, closed_at = NOW(), closed_by = $2::uuid, closure_reason = 'prueba de la carrera'
		 WHERE id = $1::uuid`, m.ID, owner); err != nil {
		t.Fatalf("marcar el cierre: %v", err)
	}
	if err := cierre.Commit(ctx); err != nil {
		t.Fatalf("confirmar el cierre: %v", err)
	}

	select {
	case err := <-listo:
		if !errors.Is(err, qrpayment.ErrComercioCerrado) {
			t.Fatalf("el pago en vuelo: err = %v, se esperaba ErrComercioCerrado", err)
		}
	case <-time.After(15 * time.Second):
		t.Fatal("el pago no termino despues del cierre")
	}
	if got := walletCRC(t, pool, payer); got != antes {
		t.Fatalf("la billetera del pagador cambio: %d -> %d", antes, got)
	}
	if s := saldoDelComercio(t, pool, m.ID, "CRC"); s != 0 {
		t.Fatalf("el comercio cerrado recibio %d", s)
	}
	if n := contar(t, pool, `SELECT COUNT(*) FROM qr_payments WHERE merchant_id = $1::uuid`, m.ID); n != ventasAntes {
		t.Fatalf("el comercio cerrado gano ventas: %d -> %d", ventasAntes, n)
	}
}

// CerrarComercioEnTx es la pieza que reusan los demas cierres (la eliminacion
// de la cuenta). Corre en la transaccion de quien llama: si esa transaccion se
// deshace, no queda nada, tampoco el rastro.
func TestCerrarComercioEnTx_SeDeshaceConLaTransaccion(t *testing.T) {
	svc, pool, _, owner := setupCierre(t, nil)
	ctx := context.Background()
	m := comercioVerificado(t, svc, owner)
	rotuloDelComercio(t, svc, owner, m.ID)

	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("abrir la transaccion: %v", err)
	}
	cerrado, err := qrpayment.CerrarComercioEnTx(ctx, tx, m.ID, qrpayment.Cierre{
		CerradoPor: owner, Motivo: "prueba", Accion: qrpayment.AccionCierrePropio,
	})
	if err != nil {
		_ = tx.Rollback(ctx)
		t.Fatalf("cerrar en la transaccion: %v", err)
	}
	if cerrado.ClosedAt == nil {
		_ = tx.Rollback(ctx)
		t.Fatalf("respuesta sin cierre: %+v", cerrado)
	}
	if err := tx.Rollback(ctx); err != nil {
		t.Fatalf("deshacer: %v", err)
	}

	if f := leerCierre(t, pool, m.ID); f.cerradoEn != nil || !f.activo {
		t.Fatalf("el rollback dejo el comercio cerrado: %+v", f)
	}
	if n := contar(t, pool,
		`SELECT COUNT(*) FROM qr_payment_codes WHERE merchant_id = $1::uuid AND status = 'active'`, m.ID); n != 1 {
		t.Fatalf("el rollback dejo %d rotulos vivos, se esperaba 1", n)
	}
	if n := contar(t, pool, `SELECT COUNT(*) FROM audit_logs WHERE action = 'merchant_closed'`); n != 0 {
		t.Fatalf("el rollback dejo %d filas de auditoria", n)
	}

	// Sin motivo o sin quien cierra, ni empieza.
	for _, c := range []qrpayment.Cierre{
		{CerradoPor: owner, Motivo: "  ", Accion: qrpayment.AccionCierrePropio},
		{CerradoPor: "", Motivo: "prueba", Accion: qrpayment.AccionCierrePropio},
	} {
		tx, err := pool.Begin(ctx)
		if err != nil {
			t.Fatalf("abrir la transaccion: %v", err)
		}
		_, err = qrpayment.CerrarComercioEnTx(ctx, tx, m.ID, c)
		_ = tx.Rollback(ctx)
		if err == nil {
			t.Fatalf("cierre %+v aceptado", c)
		}
	}
}

// ── El cierre del administrador ─────────────────────────────────────────────

// Un administrador cierra con motivo. La vista de administracion sigue
// mostrando el comercio, con su estado, y la cola de pendientes ya no.
func TestCerrarComercioComoAdmin_ConMotivoYSigueEnLaVistaDeAdmin(t *testing.T) {
	svc, pool, payer, owner := setupCierre(t, nil)
	ctx := context.Background()
	admin := payer // el servicio no mira el rol: eso lo hace el middleware de la ruta
	verificado := comercioVerificado(t, svc, owner)
	pendiente := registrarComercio(t, svc, owner, "Cafeteria Pendiente")

	for _, motivo := range []string{"", "   "} {
		if _, err := svc.CerrarComercioComoAdmin(ctx, verificado.ID, admin, motivo, actorDePrueba); !errors.Is(err, qrpayment.ErrMotivoDeCierreRequerido) {
			t.Fatalf("motivo %q: err = %v, se esperaba ErrMotivoDeCierreRequerido", motivo, err)
		}
	}
	if _, err := svc.CerrarComercioComoAdmin(ctx, uuid.NewString(), admin, "no existe", actorDePrueba); !errors.Is(err, qrpayment.ErrComercioNoEncontrado) {
		t.Fatalf("comercio inexistente: err = %v, se esperaba ErrComercioNoEncontrado", err)
	}

	const motivo = "Sembrado con datos de prueba"
	cerrado, err := svc.CerrarComercioComoAdmin(ctx, verificado.ID, admin, "  "+motivo+"  ", actorDePrueba)
	if err != nil {
		t.Fatalf("cerrar como administrador: %v", err)
	}
	if cerrado.ClosedBy != admin || cerrado.ClosureReason != motivo || cerrado.ClosedAt == nil || cerrado.Active {
		t.Fatalf("respuesta del cierre: %+v", cerrado)
	}
	var actor, dueno, razon, riesgo string
	if err := pool.QueryRow(ctx, `
		SELECT COALESCE(user_id::text, ''), COALESCE(details->>'owner_id', ''),
		       COALESCE(details->>'reason', ''), COALESCE(risk_level, '')
		  FROM audit_logs WHERE action = 'admin_merchant_closed' AND resource_id = $1`, verificado.ID,
	).Scan(&actor, &dueno, &razon, &riesgo); err != nil {
		t.Fatalf("leer la auditoria: %v", err)
	}
	if actor != admin || dueno != owner || razon != motivo || riesgo != "high" {
		t.Fatalf("auditoria: actor=%s dueno=%s motivo=%s riesgo=%s", actor, dueno, razon, riesgo)
	}

	// Un pendiente tambien se cierra, y sale de la cola de verificacion.
	if _, err := svc.CerrarComercioComoAdmin(ctx, pendiente.ID, admin, "Duplicado", actorDePrueba); err != nil {
		t.Fatalf("cerrar el pendiente: %v", err)
	}
	cola, err := svc.ListPendingMerchants(ctx)
	if err != nil {
		t.Fatalf("cola de pendientes: %v", err)
	}
	for _, c := range cola {
		if c.ID == pendiente.ID {
			t.Fatal("un comercio cerrado sigue en la cola de verificacion")
		}
	}

	// La vista de administracion los sigue mostrando, con su estado.
	todos, err := svc.ListarComercios(ctx, "")
	if err != nil {
		t.Fatalf("listar los comercios: %v", err)
	}
	var visto *qrpayment.Merchant
	for i := range todos {
		if todos[i].ID == verificado.ID {
			visto = &todos[i]
		}
	}
	if visto == nil || visto.ClosedAt == nil || visto.ClosureReason != motivo || visto.ClosedBy != admin || visto.Active {
		t.Fatalf("el comercio cerrado en la vista de administracion: %+v", visto)
	}
	if visto.OwnerName == "" {
		t.Fatalf("la vista de administracion no dice de quien es el comercio: %+v", visto)
	}

	// La busqueda: por nombre sin importar mayusculas, y por el identificador.
	porNombre, err := svc.ListarComercios(ctx, "TICA")
	if err != nil || len(porNombre) != 1 || porNombre[0].ID != verificado.ID {
		t.Fatalf("buscar por nombre = %+v (err %v)", porNombre, err)
	}
	porID, err := svc.ListarComercios(ctx, pendiente.ID)
	if err != nil || len(porID) != 1 || porID[0].ID != pendiente.ID {
		t.Fatalf("buscar por identificador = %+v (err %v)", porID, err)
	}
	// Un comodin de LIKE se busca como texto, no como comodin.
	if ninguno, err := svc.ListarComercios(ctx, "%"); err != nil || len(ninguno) != 0 {
		t.Fatalf("buscar %% = %+v (err %v), se esperaba vacio", ninguno, err)
	}
}

// ── Por HTTP ────────────────────────────────────────────────────────────────

type sobreDelError struct {
	Error struct {
		Code    string          `json:"code"`
		Details json.RawMessage `json:"details"`
	} `json:"error"`
	Data json.RawMessage `json:"data"`
}

func leerSobre(t *testing.T, rec *httptest.ResponseRecorder) sobreDelError {
	t.Helper()
	var s sobreDelError
	if err := json.Unmarshal(rec.Body.Bytes(), &s); err != nil {
		t.Fatalf("respuesta ilegible: %v (%s)", err, rec.Body.String())
	}
	return s
}

func TestCerrarComercio_PorHTTP(t *testing.T) {
	tope := nuevoTope()
	svc, pool, payer, owner := setupCierre(t, &qrpayment.Options{Lockout: tope, MaxIntentosDeCierre: 5})
	h := qrpayment.NewHandler(svc)
	m := comercioVerificado(t, svc, owner)
	rotulo := rotuloDelComercio(t, svc, owner, m.ID)

	cerrar := func(cuerpo string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		h.CloseMerchant(rec, peticion(http.MethodPost, "/api/v1/qr/merchants/"+m.ID+"/close", cuerpo, owner, m.ID))
		return rec
	}

	if rec := cerrar(`{"password":"otra"}`); rec.Code != http.StatusBadRequest || codigoDeError(t, rec) != "CURRENT_PASSWORD_INVALID" {
		t.Fatalf("contrasena equivocada: %d %s", rec.Code, rec.Body.String())
	}
	if rec := cerrar(`no es json`); rec.Code != http.StatusBadRequest || codigoDeError(t, rec) != "INVALID_BODY" {
		t.Fatalf("cuerpo ilegible: %d %s", rec.Code, rec.Body.String())
	}
	rec := httptest.NewRecorder()
	h.CloseMerchant(rec, peticion(http.MethodPost, "/api/v1/qr/merchants/no-es-un-id/close", `{"password":"x"}`, owner, "no-es-un-id"))
	if rec.Code != http.StatusNotFound || codigoDeError(t, rec) != "MERCHANT_NOT_FOUND" {
		t.Fatalf("id que no es UUID: %d %s", rec.Code, rec.Body.String())
	}

	// Con saldo: 409 con lo que queda, para que la pantalla lo diga.
	pagarAlComercio(t, svc, payer, owner, m.ID, 100000)
	saldo := saldoDelComercio(t, pool, m.ID, "CRC")
	rec = cerrar(`{"password":"` + claveDelDueno + `"}`)
	if rec.Code != http.StatusConflict || codigoDeError(t, rec) != "MERCHANT_HAS_BALANCE" {
		t.Fatalf("con saldo: %d %s", rec.Code, rec.Body.String())
	}
	var conSaldo struct {
		Balances []struct {
			Currency string `json:"currency"`
			Amount   int64  `json:"amount"`
		} `json:"balances"`
	}
	if err := json.Unmarshal(leerSobre(t, rec).Error.Details, &conSaldo); err != nil ||
		len(conSaldo.Balances) != 1 || conSaldo.Balances[0].Currency != "CRC" || conSaldo.Balances[0].Amount != saldo {
		t.Fatalf("detalle del saldo = %+v (err %v), se esperaba CRC %d", conSaldo, err, saldo)
	}
	if _, err := svc.WithdrawToOwner(context.Background(), m.ID, owner, "CRC", saldo, "retiro-por-http"); err != nil {
		t.Fatalf("retirar: %v", err)
	}

	// Con un cobro pendiente: 409 con cuantos.
	cobro, err := svc.CreateCharge(context.Background(), owner, &qrpayment.CreateChargeRequest{QRCodeID: rotulo.ID, Amount: 5000})
	if err != nil {
		t.Fatalf("emitir el cobro: %v", err)
	}
	rec = cerrar(`{"password":"` + claveDelDueno + `"}`)
	if rec.Code != http.StatusConflict || codigoDeError(t, rec) != "MERCHANT_HAS_PENDING_CHARGES" {
		t.Fatalf("con cobro pendiente: %d %s", rec.Code, rec.Body.String())
	}
	var conCobros struct {
		Pendientes int `json:"pending_charges"`
	}
	if err := json.Unmarshal(leerSobre(t, rec).Error.Details, &conCobros); err != nil || conCobros.Pendientes != 1 {
		t.Fatalf("detalle de los cobros = %+v (err %v)", conCobros, err)
	}
	if err := svc.CancelCharge(context.Background(), owner, cobro.ID); err != nil {
		t.Fatalf("cancelar el cobro: %v", err)
	}

	rec = cerrar(`{"password":"` + claveDelDueno + `"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("cerrar: %d %s", rec.Code, rec.Body.String())
	}
	var cerrado struct {
		ClosedAt      *time.Time `json:"closed_at"`
		ClosureReason string     `json:"closure_reason"`
		Active        bool       `json:"active"`
	}
	if err := json.Unmarshal(leerSobre(t, rec).Data, &cerrado); err != nil || cerrado.ClosedAt == nil ||
		cerrado.Active || cerrado.ClosureReason != qrpayment.MotivoCierrePropio {
		t.Fatalf("respuesta del cierre = %+v (err %v)", cerrado, err)
	}
	if rec := cerrar(`{"password":"` + claveDelDueno + `"}`); rec.Code != http.StatusConflict || codigoDeError(t, rec) != "MERCHANT_CLOSED" {
		t.Fatalf("cerrar otra vez: %d %s", rec.Code, rec.Body.String())
	}

	// Pagarle y resolver su codigo: 409 MERCHANT_CLOSED.
	rec = httptest.NewRecorder()
	h.ResolveQR(rec, peticion(http.MethodPost, "/api/v1/qr/resolve", `{"qr_data":"`+rotulo.QRData+`"}`, payer, ""))
	if rec.Code != http.StatusConflict || codigoDeError(t, rec) != "MERCHANT_CLOSED" {
		t.Fatalf("resolver: %d %s", rec.Code, rec.Body.String())
	}
	rec = httptest.NewRecorder()
	h.ScanAndPay(rec, peticion(http.MethodPost, "/api/v1/qr/pay",
		`{"qr_data":"`+rotulo.QRData+`","amount":5000,"currency":"CRC","idempotency_key":"pago-http-cerrado"}`, payer, ""))
	if rec.Code != http.StatusConflict || codigoDeError(t, rec) != "MERCHANT_CLOSED" {
		t.Fatalf("pagar: %d %s", rec.Code, rec.Body.String())
	}

	// La lista del dueno ya no lo trae.
	rec = httptest.NewRecorder()
	h.GetMerchants(rec, peticion(http.MethodGet, "/api/v1/qr/merchants", "", owner, ""))
	var lista []struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(leerSobre(t, rec).Data, &lista); err != nil || len(lista) != 0 {
		t.Fatalf("lista del dueno = %+v (err %v), se esperaba vacia", lista, err)
	}
}

func TestCerrarComercio_PorHTTP_DemoTopeYSegundoFactor(t *testing.T) {
	tope := nuevoTope()
	svc, pool, _, owner := setupCierre(t, &qrpayment.Options{
		Lockout: tope, MaxIntentosDeCierre: 1, TOTP: autenticadorDePrueba{codigo: "123456"},
	})
	h := qrpayment.NewHandler(svc)
	m := comercioVerificado(t, svc, owner)

	cerrar := func(quien, comercio, cuerpo string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		h.CloseMerchant(rec, peticion(http.MethodPost, "/api/v1/qr/merchants/"+comercio+"/close", cuerpo, quien, comercio))
		return rec
	}

	if rec := cerrar(owner, m.ID, `{"password":"`+claveDelDueno+`"}`); rec.Code != http.StatusBadRequest || codigoDeError(t, rec) != "TOTP_REQUIRED" {
		t.Fatalf("sin el codigo: %d %s", rec.Code, rec.Body.String())
	}
	tope.vaciar()
	if rec := cerrar(owner, m.ID, `{"password":"`+claveDelDueno+`","totp_code":"999999"}`); rec.Code != http.StatusBadRequest || codigoDeError(t, rec) != "TOTP_INVALID" {
		t.Fatalf("codigo equivocado: %d %s", rec.Code, rec.Body.String())
	}
	if rec := cerrar(owner, m.ID, `{"password":"`+claveDelDueno+`","totp_code":"123456"}`); rec.Code != http.StatusLocked || codigoDeError(t, rec) != "MERCHANT_CLOSE_LOCKED" {
		t.Fatalf("pasado el tope: %d %s", rec.Code, rec.Body.String())
	}

	demo := testutil.SeedTestUser3(t, pool)
	if _, err := pool.Exec(context.Background(), `UPDATE users SET demo_login = TRUE WHERE id = $1::uuid`, demo); err != nil {
		t.Fatalf("marcar la cuenta de demostracion: %v", err)
	}
	deDemo := registrarComercio(t, svc, demo, "Soda Demo")
	if rec := cerrar(demo, deDemo.ID, `{"password":"x"}`); rec.Code != http.StatusForbidden || codigoDeError(t, rec) != "DEMO_ACCOUNT" {
		t.Fatalf("cuenta de demostracion: %d %s", rec.Code, rec.Body.String())
	}
	if rec := cerrar(owner, deDemo.ID, `{"password":"`+claveDelDueno+`"}`); rec.Code != http.StatusNotFound || codigoDeError(t, rec) != "MERCHANT_NOT_FOUND" {
		t.Fatalf("comercio ajeno: %d %s", rec.Code, rec.Body.String())
	}
}

func TestCerrarComercioComoAdmin_PorHTTP(t *testing.T) {
	svc, _, payer, owner := setupCierre(t, nil)
	h := qrpayment.NewHandler(svc)
	admin := payer
	m := comercioVerificado(t, svc, owner)

	cerrar := func(comercio, cuerpo string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		h.AdminCloseMerchant(rec, peticion(http.MethodPost, "/api/v1/admin/merchants/"+comercio+"/close", cuerpo, admin, comercio))
		return rec
	}

	if rec := cerrar(m.ID, `{"reason":"  "}`); rec.Code != http.StatusBadRequest || codigoDeError(t, rec) != "CLOSURE_REASON_REQUIRED" {
		t.Fatalf("sin motivo: %d %s", rec.Code, rec.Body.String())
	}
	if rec := cerrar("no-es-un-id", `{"reason":"x"}`); rec.Code != http.StatusBadRequest || codigoDeError(t, rec) != "INVALID_ID" {
		t.Fatalf("id que no es UUID: %d %s", rec.Code, rec.Body.String())
	}
	if rec := cerrar(uuid.NewString(), `{"reason":"x"}`); rec.Code != http.StatusNotFound || codigoDeError(t, rec) != "MERCHANT_NOT_FOUND" {
		t.Fatalf("inexistente: %d %s", rec.Code, rec.Body.String())
	}
	if rec := cerrar(m.ID, `{"reason":"Datos de prueba"}`); rec.Code != http.StatusOK {
		t.Fatalf("cerrar: %d %s", rec.Code, rec.Body.String())
	}
	if rec := cerrar(m.ID, `{"reason":"Otra vez"}`); rec.Code != http.StatusConflict || codigoDeError(t, rec) != "MERCHANT_CLOSED" {
		t.Fatalf("cerrar otra vez: %d %s", rec.Code, rec.Body.String())
	}

	rec := httptest.NewRecorder()
	h.AdminListMerchants(rec, peticion(http.MethodGet, "/api/v1/admin/merchants?q=soda", "", admin, ""))
	if rec.Code != http.StatusOK {
		t.Fatalf("listar: %d %s", rec.Code, rec.Body.String())
	}
	var lista []struct {
		ID            string     `json:"id"`
		ClosedAt      *time.Time `json:"closed_at"`
		ClosedBy      string     `json:"closed_by"`
		ClosureReason string     `json:"closure_reason"`
		OwnerName     string     `json:"owner_name"`
	}
	if err := json.Unmarshal(leerSobre(t, rec).Data, &lista); err != nil || len(lista) != 1 {
		t.Fatalf("lista de administracion = %+v (err %v)", lista, err)
	}
	if c := lista[0]; c.ID != m.ID || c.ClosedAt == nil || c.ClosedBy != admin || c.ClosureReason != "Datos de prueba" || c.OwnerName == "" {
		t.Fatalf("comercio cerrado en la lista de administracion: %+v", c)
	}
}
