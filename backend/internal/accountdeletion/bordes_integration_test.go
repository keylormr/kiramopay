package accountdeletion

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/kiramopay/backend/internal/auth"
	"github.com/kiramopay/backend/internal/ledger"
	"github.com/kiramopay/backend/internal/testutil"
)

// Los bordes de la linea de tiempo: lo que pasa cuando algo se mete en el
// medio, cuando el barrido no puede cerrar, y lo que la persona recibe en cada
// paso.

// trazadorQueSeMete corre f una sola vez, justo antes de la primera consulta del
// servicio que contiene marca. Es la forma de hacer que algo confirme EN EL
// MEDIO de una transaccion del servicio, despues de que tomo su foto, sin tocar
// el codigo de produccion.
type trazadorQueSeMete struct {
	marca string
	una   sync.Once
	f     func()
}

func (z *trazadorQueSeMete) TraceQueryStart(ctx context.Context, _ *pgx.Conn, d pgx.TraceQueryStartData) context.Context {
	if strings.Contains(d.SQL, z.marca) {
		z.una.Do(z.f)
	}
	return ctx
}

func (*trazadorQueSeMete) TraceQueryEnd(context.Context, *pgx.Conn, pgx.TraceQueryEndData) {}

// Un cobro al comercio que confirma despues de que la solicitud del dia 0 tomo
// su foto. El saldo de un comercio sale del diario, asi que la foto vieja lo ve
// en cero; si el cierre del libro pasara igual, el comercio quedaria cerrado con
// dinero adentro y sin forma de sacarlo. La solicitud tiene que enterarse: o ve
// el saldo y se niega, o el cobro encuentra la cuenta cerrada.
func TestDiaCero_UnCobroAlComercioEnElMedioNoQuedaVarado(t *testing.T) {
	pool := testutil.TestDB(t)
	ctx := context.Background()
	a, b := sembrar(t, pool), sembrar(t, pool)
	m := comercioDe(t, pool, a.ID)
	fondear(t, pool, b.ID, 5000)
	// Un comercio que ya cobro y retiro: su cuenta existe, en cero.
	exec(t, pool, `INSERT INTO ledger_accounts (code, type, merchant_id, currency, normal_balance)
		VALUES ('MERCHANT:' || $1 || ':CRC', 'merchant_wallet', $1::uuid, 'CRC', 'credit')`, m)

	eng := ledger.NewEngine(pool, nil)
	var errCobro error
	z := &trazadorQueSeMete{
		// La solicitud ya leyo la fila de la persona (la foto esta tomada) y va
		// a bloquear su billetera.
		marca: "FROM wallets WHERE user_id = $1::uuid FOR UPDATE",
		f: func() {
			_, errCobro = eng.Post(ctx, &ledger.Posting{
				Description: "cobro al comercio",
				Entries: []ledger.Entry{
					{Account: ledger.Account{UserID: b.ID}, Side: ledger.Debit, AmountMinor: 1000, Currency: "CRC"},
					{Account: ledger.Account{MerchantID: m}, Side: ledger.Credit, AmountMinor: 1000, Currency: "CRC"},
				},
			})
		},
	}
	svc := nuevoServicio(testutil.PoolTrazado(t, z), nil)
	_, errPedido := svc.iniciar(ctx, a.ID, opciones{canal: CanalApp})

	if errCobro != nil {
		t.Fatalf("el cobro del medio fallo: %v", errCobro)
	}
	if got := codigosDe(errPedido); len(got) != 1 || got[0] != BloqueoSaldoComercio {
		t.Fatalf("la solicitud debia ver el saldo del comercio y negarse: err=%v codigos=%v", errPedido, got)
	}
	if st := cuenta1[string](t, pool, `SELECT status FROM users WHERE id = $1::uuid`, a.ID); st != "active" {
		t.Errorf("la cuenta quedo en %s", st)
	}
	if n := cuenta1[int](t, pool, `SELECT COUNT(*) FROM ledger_accounts WHERE merchant_id = $1::uuid AND closed_at IS NOT NULL`, m); n != 0 {
		t.Errorf("el comercio quedo con %d cuentas cerradas y dinero adentro", n)
	}
}

// Vencida y sin cerrar, el login sigue ofreciendo la reactivacion, con la fecha
// que ya paso, y reactivar entra.
func TestLogin_VencidaSinCerrarOfreceReactivar(t *testing.T) {
	pool := testutil.TestDB(t)
	ctx := context.Background()
	a := sembrar(t, pool)
	svc := nuevoServicio(pool, nil)
	pedir(t, svc, a.ID)
	vencerPlazo(t, pool, a.ID)
	login := servicioDeLogin(pool, svc)

	_, err := login.Login(ctx, &auth.LoginRequest{Identifier: a.Cedula, Password: claveDePrueba}, auth.LoginContext{})
	var porEliminar *auth.CuentaPorEliminarError
	if !errors.As(err, &porEliminar) {
		t.Fatalf("se esperaba la oferta de reactivar, salio %v", err)
	}
	if !porEliminar.SeEliminaEl.Before(time.Now()) {
		t.Errorf("la fecha del aviso %v debia ser la que ya paso", porEliminar.SeEliminaEl)
	}
	resp, err := login.Login(ctx, &auth.LoginRequest{Identifier: a.Cedula, Password: claveDePrueba, Reactivate: true}, auth.LoginContext{})
	if err != nil || resp == nil || resp.Tokens == nil {
		t.Fatalf("reactivar vencida y sin cerrar: %+v %v", resp, err)
	}
}

// Una cuenta que no se puede cerrar no tapa a las demas: el barrido sigue con
// las que vienen detras aunque el lote sea de una.
func TestDiaTreinta_UnaCuentaAtascadaNoTapaALasDemas(t *testing.T) {
	pool := testutil.TestDB(t)
	ctx := context.Background()
	svc := nuevoServicio(pool, nil)
	atascada, limpia := sembrar(t, pool), sembrar(t, pool)
	pedir(t, svc, atascada.ID)
	pedir(t, svc, limpia.ID)
	exec(t, pool, `INSERT INTO payouts (user_id, rail, amount_minor, destination, idempotency_key, status)
		VALUES ($1::uuid, 'MOCK', 100, '{}', 'pendiente-' || $1::text, 'processing')`, atascada.ID)
	vencerPlazo(t, pool, limpia.ID)
	// La atascada vencio antes: es la primera de la fila.
	vencerPlazo(t, pool, atascada.ID)
	vencerPlazo(t, pool, atascada.ID)

	n, err := svc.CerrarVencidas(ctx, time.Now(), 1)
	if err != nil {
		t.Fatalf("barrido: %v", err)
	}
	if n != 1 {
		t.Errorf("cerro %d cuentas, se esperaba 1", n)
	}
	if st := cuenta1[string](t, pool, `SELECT status FROM users WHERE id = $1::uuid`, limpia.ID); st != "closed" {
		t.Errorf("la cuenta limpia quedo en %s detras de la atascada", st)
	}
	if st := cuenta1[string](t, pool, `SELECT status FROM users WHERE id = $1::uuid`, atascada.ID); st != "pending_deletion" {
		t.Errorf("la atascada quedo en %s", st)
	}
}

// Pedir otro codigo no devuelve los intentos: si devolviera, quien conoce el
// correo de otra persona podria probar cinco codigos por minuto, para siempre.
// Los intentos vuelven recien cuando pasa un dia sin pedir codigos.
func TestSolicitar_PedirOtroCodigoNoDevuelveLosIntentos(t *testing.T) {
	pool := testutil.TestDB(t)
	a := sembrar(t, pool)
	correo := nuevoCorreo()
	svc := nuevoServicio(pool, &Options{Email: correo})
	ctx := context.Background()

	if err := svc.Solicitar(ctx, a.Correo, true); err != nil {
		t.Fatal(err)
	}
	esperar(t, correo.ch)
	for i := 0; i < maxIntentosCodigo; i++ {
		if err := svc.Verificar(ctx, a.Correo, "000000"); !errors.Is(err, ErrCodigoInvalido) {
			t.Fatalf("intento %d: %v", i, err)
		}
	}

	// Paso la espera entre codigos y se pide otro.
	exec(t, pool, `UPDATE account_deletion_requests SET verification_expires_at = NOW() + interval '1 minute'
		WHERE status = 'pending_verification'`)
	if err := svc.Solicitar(ctx, a.Correo, true); err != nil {
		t.Fatal(err)
	}
	select {
	case m := <-correo.ch:
		if err := svc.Verificar(ctx, a.Correo, codigoDe(t, m)); !errors.Is(err, ErrCodigoInvalido) {
			t.Fatalf("con los intentos agotados, el codigo nuevo no debia servir: %v", err)
		}
	case <-time.After(2 * time.Second):
	}
	if st := cuenta1[string](t, pool, `SELECT status FROM users WHERE id = $1::uuid`, a.ID); st != "active" {
		t.Fatalf("la cuenta quedo en %s", st)
	}

	// Un dia despues del ultimo codigo, los intentos vuelven.
	exec(t, pool, `UPDATE account_deletion_requests SET verification_expires_at = NOW() - interval '25 hours'
		WHERE status = 'pending_verification'`)
	if err := svc.Solicitar(ctx, a.Correo, true); err != nil {
		t.Fatal(err)
	}
	if err := svc.Verificar(ctx, a.Correo, codigoDe(t, esperar(t, correo.ch))); err != nil {
		t.Fatalf("un dia despues el codigo nuevo debia servir: %v", err)
	}
}

// La desasociacion es irreversible: no se hace mientras haya un caso abierto
// sobre la persona (un reporte sin revisar o una alerta de fraude en curso). Se
// hace cuando el caso se cierra.
func TestDesasociar_NoConUnCasoAbierto(t *testing.T) {
	ctx := context.Background()
	casos := []struct {
		nombre, abrir, cerrar string
	}{
		{"reporte sin revisar",
			`INSERT INTO uif_reports (user_id, report_type, amount_minor, currency, reason, status)
			 VALUES ($1::uuid, 'manual', 100, 'CRC', 'caso de prueba', 'pending')`,
			`UPDATE uif_reports SET status = 'dismissed' WHERE user_id = $1::uuid`},
		{"alerta de fraude en curso",
			`WITH f AS (INSERT INTO fraud_assessments (user_id, tx_type, tx_id, amount, risk_score, risk_level, factors, action)
			            VALUES ($1::uuid, 'sinpe', 'tx-abierta', 100, 80, 'high', '[]', 'review') RETURNING id)
			 INSERT INTO fraud_alerts (user_id, assessment_id, type, severity, message, status)
			 SELECT $1::uuid, f.id, 'velocity', 'high', 'caso de prueba', 'investigating' FROM f`,
			`UPDATE fraud_alerts SET status = 'resolved' WHERE user_id = $1::uuid`},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			pool := testutil.TestDB(t)
			a := sembrar(t, pool)
			svc := nuevoServicio(pool, nil)
			pedir(t, svc, a.ID)
			cerrar(t, pool, svc, a.ID)
			exec(t, pool, c.abrir, a.ID)
			envejecer(t, pool, a.ID, 5)

			if n, err := svc.DesasociarVencidas(ctx, time.Now(), 100); err != nil || n != 0 {
				t.Fatalf("con el caso abierto no debia desasociar: n=%d err=%v", n, err)
			}
			exec(t, pool, c.cerrar, a.ID)
			if n, err := svc.DesasociarVencidas(ctx, time.Now(), 100); err != nil || n != 1 {
				t.Fatalf("cerrado el caso debia desasociar: n=%d err=%v", n, err)
			}
		})
	}
}

// marcasFalsas guarda las marcas de bloqueo que el servicio pone y quita.
type marcasFalsas struct {
	mu      sync.Mutex
	puestas map[string]bool
}

func (m *marcasFalsas) MarkUserBlocked(_ context.Context, userID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.puestas[userID] = true
	return nil
}

func (m *marcasFalsas) ClearUserBlocked(_ context.Context, userID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.puestas, userID)
	return nil
}

func (m *marcasFalsas) tiene(userID string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.puestas[userID]
}

// El dia 0 pone la misma marca que el bloqueo: un token de acceso que quedo
// vivo (emitido antes de la ultima rotacion) se rechaza en la proxima peticion
// y no recien cuando vence. Reactivar la quita.
func TestDiaCero_MarcaLaCuentaParaQueNingunTokenSigaVivo(t *testing.T) {
	pool := testutil.TestDB(t)
	ctx := context.Background()
	a := sembrar(t, pool)
	marcas := &marcasFalsas{puestas: map[string]bool{}}
	svc := nuevoServicio(pool, &Options{Marcas: marcas})

	if _, err := svc.EliminarMiCuenta(ctx, a.ID, Confirmacion{Password: claveDePrueba, AceptaPlazo: true}); err != nil {
		t.Fatalf("pedir: %v", err)
	}
	if !marcas.tiene(a.ID) {
		t.Fatal("el dia 0 no marco la cuenta")
	}
	if ok, err := svc.Reactivar(ctx, a.ID); err != nil || !ok {
		t.Fatalf("reactivar: ok=%v err=%v", ok, err)
	}
	if marcas.tiene(a.ID) {
		t.Error("reactivar no quito la marca")
	}
}

// Una cuenta de demostracion no se elimina por ninguna via: tampoco por la web,
// donde basta el codigo del correo.
func TestVerificar_UnaCuentaDemoNoSeEliminaPorLaWeb(t *testing.T) {
	pool := testutil.TestDB(t)
	a := sembrar(t, pool)
	exec(t, pool, `UPDATE users SET demo_login = true WHERE id = $1::uuid`, a.ID)
	correo := nuevoCorreo()
	svc := nuevoServicio(pool, &Options{Email: correo})
	ctx := context.Background()

	if err := svc.Solicitar(ctx, a.Correo, true); err != nil {
		t.Fatal(err)
	}
	if err := svc.Verificar(ctx, a.Correo, codigoDe(t, esperar(t, correo.ch))); err != nil {
		t.Fatalf("verificar: %v", err)
	}
	if st := cuenta1[string](t, pool, `SELECT status FROM users WHERE id = $1::uuid`, a.ID); st != "active" {
		t.Fatalf("una cuenta de demostracion quedo en %s", st)
	}
	var estado, codigo string
	if err := pool.QueryRow(ctx, `SELECT status, result_code FROM account_deletion_requests WHERE user_id = $1::uuid`, a.ID).Scan(&estado, &codigo); err != nil {
		t.Fatal(err)
	}
	if estado != "rejected" || codigo != "DEMO_ACCOUNT" {
		t.Errorf("la solicitud quedo en %s/%s", estado, codigo)
	}
}

// Reactivar avisa por correo: si quien reactiva no es la persona (alguien con
// su contrasena), la persona se entera.
func TestReactivar_AvisaPorCorreo(t *testing.T) {
	pool := testutil.TestDB(t)
	ctx := context.Background()
	a := sembrar(t, pool)
	correo := nuevoCorreo()
	svc := nuevoServicio(pool, &Options{Email: correo})
	pedir(t, svc, a.ID)

	if ok, err := svc.Reactivar(ctx, a.ID); err != nil || !ok {
		t.Fatalf("reactivar: ok=%v err=%v", ok, err)
	}
	m := esperar(t, correo.ch)
	if m.Para != a.Correo || !strings.Contains(m.Texto, "reactiv") {
		t.Errorf("el aviso de la reactivacion no llego como se esperaba: %+v", m)
	}
	if mencionProhibida.MatchString(m.Texto) {
		t.Errorf("el aviso menciona lo que no debe: %q", m.Texto)
	}
}

// Quien vuelve a pedir por la web la eliminacion de una cuenta que ya esta en
// plazo recibe otra vez la respuesta escrita: la pagina le promete un correo.
func TestVerificar_UnaCuentaYaEnPlazoRecibeOtraVezLaRespuesta(t *testing.T) {
	pool := testutil.TestDB(t)
	a := sembrar(t, pool)
	correo := nuevoCorreo()
	svc := nuevoServicio(pool, &Options{Email: correo})
	ctx := context.Background()
	pedir(t, svc, a.ID)

	if err := svc.Solicitar(ctx, a.Correo, true); err != nil {
		t.Fatal(err)
	}
	if err := svc.Verificar(ctx, a.Correo, codigoDe(t, esperar(t, correo.ch))); err != nil {
		t.Fatalf("verificar: %v", err)
	}
	if m := esperar(t, correo.ch); m.Para != a.Correo || !strings.Contains(m.Texto, "PRODHAB") {
		t.Errorf("la respuesta escrita no llego otra vez: %+v", m)
	}
}

// marcasQueNoSeQuitan falla al quitar la marca, como un Redis caido.
type marcasQueNoSeQuitan struct{ marcasFalsas }

func (*marcasQueNoSeQuitan) ClearUserBlocked(context.Context, string) error {
	return errors.New("redis caido")
}

// Si la marca no se puede quitar, no se reactiva. Reactivar con la marca puesta
// dejaria a la persona entrando a una cuenta activa que responde "bloqueada" en
// cada peticion, sin nada que vuelva a intentar quitarla. Asi la cuenta sigue
// en plazo y la persona reintenta.
func TestReactivar_SinPoderQuitarLaMarcaNoReactiva(t *testing.T) {
	pool := testutil.TestDB(t)
	ctx := context.Background()
	a := sembrar(t, pool)
	svc := nuevoServicio(pool, &Options{Marcas: &marcasQueNoSeQuitan{marcasFalsas{puestas: map[string]bool{}}}})
	pedir(t, svc, a.ID)

	if ok, err := svc.Reactivar(ctx, a.ID); err == nil || ok {
		t.Fatalf("reactivar sin poder quitar la marca: ok=%v err=%v, se esperaba el error", ok, err)
	}
	if st := cuenta1[string](t, pool, `SELECT status FROM users WHERE id = $1::uuid`, a.ID); st != "pending_deletion" {
		t.Fatalf("la cuenta quedo en %s", st)
	}
}

// Una cuenta que operaciones bloqueo durante el plazo no se reactiva sola, y su
// marca no se toca: es la del bloqueo.
func TestReactivar_UnaCuentaBloqueadaConservaLaMarca(t *testing.T) {
	pool := testutil.TestDB(t)
	ctx := context.Background()
	a := sembrar(t, pool)
	marcas := &marcasFalsas{puestas: map[string]bool{}}
	svc := nuevoServicio(pool, &Options{Marcas: marcas})
	pedir(t, svc, a.ID)
	exec(t, pool, `UPDATE users SET status = 'blocked', blocked_at = NOW(), blocked_reason = 'revision'
		WHERE id = $1::uuid`, a.ID)
	if err := marcas.MarkUserBlocked(ctx, a.ID); err != nil {
		t.Fatal(err)
	}

	if ok, err := svc.Reactivar(ctx, a.ID); err != nil || ok {
		t.Fatalf("reactivar una cuenta bloqueada: ok=%v err=%v", ok, err)
	}
	if !marcas.tiene(a.ID) {
		t.Error("reactivar le quito la marca a una cuenta bloqueada")
	}
}

// Una alerta que nadie atendio no es un caso en curso: las alertas nacen
// abiertas y solo las cierra una persona, asi que esperar por ellas alargaria
// la conservacion sin que la ley ni una autoridad lo pidan.
func TestDesasociar_UnaAlertaSinAtenderNoLaDetiene(t *testing.T) {
	pool := testutil.TestDB(t)
	ctx := context.Background()
	a := sembrar(t, pool)
	svc := nuevoServicio(pool, nil)
	pedir(t, svc, a.ID)
	cerrar(t, pool, svc, a.ID)
	exec(t, pool, `WITH f AS (INSERT INTO fraud_assessments (user_id, tx_type, tx_id, amount, risk_score, risk_level, factors, action)
	                          VALUES ($1::uuid, 'sinpe', 'tx-sin-atender', 100, 80, 'high', '[]', 'review') RETURNING id)
	               INSERT INTO fraud_alerts (user_id, assessment_id, type, severity, message, status)
	               SELECT $1::uuid, f.id, 'velocity', 'high', 'alerta sin atender', 'open' FROM f`, a.ID)
	envejecer(t, pool, a.ID, 5)

	if n, err := svc.DesasociarVencidas(ctx, time.Now(), 100); err != nil || n != 1 {
		t.Fatalf("una alerta sin atender no debia detenerla: n=%d err=%v", n, err)
	}
}

// Ningun caso abierto la detiene mas alla del tope de diez anos.
func TestDesasociar_UnCasoAbiertoNoLaDetieneMasDeDiezAnos(t *testing.T) {
	pool := testutil.TestDB(t)
	ctx := context.Background()
	a := sembrar(t, pool)
	svc := nuevoServicio(pool, nil)
	pedir(t, svc, a.ID)
	cerrar(t, pool, svc, a.ID)
	exec(t, pool, `INSERT INTO uif_reports (user_id, report_type, amount_minor, currency, reason, status)
		VALUES ($1::uuid, 'manual', 100, 'CRC', 'caso de prueba', 'pending')`, a.ID)
	envejecer(t, pool, a.ID, 10)

	if n, err := svc.DesasociarVencidas(ctx, time.Now(), 100); err != nil || n != 1 {
		t.Fatalf("pasados diez anos debia desasociar: n=%d err=%v", n, err)
	}
}

// Igual que el cierre, la desasociacion recorre por lotes: con lotes de una,
// las dos vencidas se desasocian en la misma pasada.
func TestDesasociar_ConLotesDeUnaRecorreTodas(t *testing.T) {
	pool := testutil.TestDB(t)
	ctx := context.Background()
	svc := nuevoServicio(pool, nil)
	a, b := sembrar(t, pool), sembrar(t, pool)
	for _, c := range []cuenta{a, b} {
		pedir(t, svc, c.ID)
		cerrar(t, pool, svc, c.ID)
		envejecer(t, pool, c.ID, 5)
	}

	if n, err := svc.DesasociarVencidas(ctx, time.Now(), 1); err != nil || n != 2 {
		t.Fatalf("con lotes de una: n=%d err=%v, se esperaban 2", n, err)
	}
}

// El motivo que escribio un administrador al cerrar el comercio es texto libre
// y puede nombrar a la persona. Al desasociar no queda: se reemplaza por la
// marca de que lo cerro un administrador, que es lo que el dueno ya leia.
func TestDesasociar_ElMotivoDelAdministradorNoQueda(t *testing.T) {
	pool := testutil.TestDB(t)
	ctx := context.Background()
	a, admin := sembrar(t, pool), sembrar(t, pool)
	m := comercioDe(t, pool, a.ID)
	exec(t, pool, `UPDATE qr_merchants
		SET active = false, closed_at = NOW(), closed_by = $2::uuid,
		    closure_reason = 'Denuncia contra Maria Rojas por cobros dobles'
		WHERE id = $1::uuid`, m, admin.ID)
	svc := nuevoServicio(pool, nil)
	pedir(t, svc, a.ID)
	cerrar(t, pool, svc, a.ID)
	envejecer(t, pool, a.ID, 5)

	if n, err := svc.DesasociarVencidas(ctx, time.Now(), 100); err != nil || n != 1 {
		t.Fatalf("desasociar: n=%d err=%v", n, err)
	}
	if motivo := cuenta1[string](t, pool, `SELECT closure_reason FROM qr_merchants WHERE id = $1::uuid`, m); motivo != "admin_closure" {
		t.Errorf("el motivo del cierre quedo %q", motivo)
	}
}
